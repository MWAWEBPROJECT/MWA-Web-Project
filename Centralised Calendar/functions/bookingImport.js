const {normalizeAudience,AUDIENCES}=require('./audience');
const {audienceError}=require('./venuePolicy');
// Pure validation/normalisation for the admin Excel (.xlsx) booking import.
// The workbook is parsed in the (admin-only) browser into plain row objects; this module
// validates them server-side so the rules cannot be bypassed by a modified client.
const { localToUtcIso, toOrgTimeParts } = require('./dateUtils');
const { adjustedIslamicToGregorian, getHijriMonthLength } = require('./hijriService');
const { sanitizePrayer, resolvePrayerInstants, PRAYER_OPTIONS } = require('./prayerTimes');
const { HttpsError } = require('firebase-functions/v2/https');

const MAX_IMPORT_ROWS = 500;
const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];
const VISIBILITIES = ['public', 'private'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HEADER_ALIASES = {
  audience:'audience', programmeaudience:'audience', id: 'id', title: 'title', department: 'department', bookingtype: 'department', venue: 'venue',
  date: 'date', datebasis: 'dateBasis', basis: 'dateBasis', start: 'start', starttime: 'start', end: 'end', endtime: 'end',
  starttype: 'startType', startprayer: 'startPrayer', startoffset: 'startOffset', startoffsetmins: 'startOffset',
  endtype: 'endType', endprayer: 'endPrayer', endoffset: 'endOffset', endoffsetmins: 'endOffset',
  speaker: 'speakerName', speakername: 'speakerName', programdetails: 'programDetails',
  status: 'status', visibility: 'visibility',
  contactname: 'contactName', contactemail: 'contactEmail', contactphone: 'contactPhone',
  notes: 'notes'
};

const pad2 = (n) => String(n).padStart(2, '0');

/** Remove control characters; drop the apostrophe the exporter adds to neutralise formulas. */
function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  let s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (/^'[=+\-@]/.test(s)) s = s.slice(1);
  return s.slice(0, max);
}

function normaliseHeaders(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const key = HEADER_ALIASES[String(k).toLowerCase().replace(/[\s_\-]/g, '')];
    if (key) out[key] = v;
  }
  return out;
}

function importIds(rawRows) {
  return [...new Set((Array.isArray(rawRows) ? rawRows : [])
    .map(row => cleanText(normaliseHeaders(row).id, 40))
    .filter(id => /^[A-Za-z0-9_-]{1,40}$/.test(id)))];
}

/**
 * Parses a date cell into {y,m,d} (or null). Accepted: 'DD/MM/YYYY' (day first, also '-' or '.'
 * separators), legacy 'YYYY-MM-DD', and (Gregorian only) an Excel serial number.
 * Never interpreted as MM/DD. Calendar validity is NOT checked here.
 */
function parseDateParts(value, { allowSerial = true } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (!allowSerial) return null;
    const t = new Date(Math.round((Math.floor(value) - 25569) * 86400000));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const s = String(value).trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (match) return { y: +match[1], m: +match[2], d: +match[3] };
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (match) return { y: +match[3], m: +match[2], d: +match[1] };
  return null;
}

/** Gregorian date cell -> 'YYYY-MM-DD' (or null if unparseable / not a real calendar date). */
function normaliseDate(value) {
  const p = parseDateParts(value);
  if (!p) return null;
  const { y, m, d } = p;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Hijri date cell (day/month/year AH, 'DD/MM/YYYY') -> {day,month,year,gregorian:'YYYY-MM-DD'} or {error}.
 * Validates the month length against the current moon-sighting adjustment.
 */
function resolveHijriDate(value, overrides = []) {
  const p = parseDateParts(value, { allowSerial: false });
  if (!p) {
    return { error: typeof value === 'number' ? 'Hijri dates must be typed as text DD/MM/YYYY (AH), not an Excel date.' : 'Hijri date must be DD/MM/YYYY (AH).' };
  }
  const { y, m, d } = p;
  if (y < 1300 || y > 1600) return { error: `Hijri year ${y} is out of range (1300-1600).` };
  if (m < 1 || m > 12) return { error: `Hijri month ${m} is invalid (1-12).` };
  const len = getHijriMonthLength(y, m, overrides);
  if (d < 1 || d > len) return { error: `Hijri month ${m}/${y} has ${len} days; day ${d} is invalid.` };
  const g = adjustedIslamicToGregorian(y, m, d, overrides);
  if (!g || !g.year) return { error: 'Could not resolve the Hijri date.' };
  return { day: d, month: m, year: y, gregorian: `${g.year}-${pad2(g.month)}-${pad2(g.day)}` };
}
/** 'HH:MM' | 'H:MM' | Excel day-fraction number -> 'HH:MM' (or null). */
function normaliseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const frac = value - Math.floor(value);
    const mins = Math.round(frac * 1440) % 1440;
    return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
  }
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim());
  if (!match) return null;
  const h = +match[1]; const mi = +match[2];
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

function nextDayKey(dateKey) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/**
 * One side (Start or End) of a row's timing. Type "Fixed" (default) needs a time; "Variable"
 * needs a prayer (Fajr, Zohrain, Asr, Maghreb, Isha) and an optional offset in minutes, and the
 * time column is ignored. Returns { time, prayer }.
 */
function parseTimeSide(label, timeValue, typeValue, prayerValue, offsetValue, problems) {
  const type = cleanText(typeValue, 20).toLowerCase();
  const variable = type.startsWith('v') || type.startsWith('p');
  if (type && !variable && !type.startsWith('f')) {
    problems.push(`${label} Type must be Fixed or Variable.`);
    return { time: null, prayer: null };
  }
  if (!variable) {
    const time = normaliseTime(timeValue);
    if (!time) problems.push(`${label} must be a time like ${label === 'Start' ? '09:00' : '17:00'} (or set ${label} Type to Variable and choose a prayer).`);
    return { time, prayer: null };
  }
  const offsetText = cleanText(offsetValue, 10);
  const offset = offsetText === '' ? 0 : Number(offsetText);
  if (!Number.isInteger(offset) || Math.abs(offset) > 360) {
    problems.push(`${label} Offset must be whole minutes between -360 and 360.`);
    return { time: null, prayer: null };
  }
  const prayer = sanitizePrayer({ key: cleanText(prayerValue, 20), offset });
  if (!prayer) problems.push(`${label} Prayer must be one of ${PRAYER_OPTIONS.map(o => o.label).join(', ')} when ${label} Type is Variable.`);
  return { time: null, prayer };
}

/**
 * @param {object[]} rawRows rows parsed from the sheet (header -> cell value)
 * @param {{departments:{id,name}[], venues:{id,name}[], existingById:Object, existingKeys:Set<string>}} ctx
 * @returns {{rows:object[], errors:{row:number,message:string}[], counts:object}}
 */
function validateImportRows(rawRows, ctx) {
  const errors = [];
  const rows = [];
  if (!Array.isArray(rawRows) || !rawRows.length) {
    return { rows, errors: [{ row: 0, message: 'The file has no data rows.' }], counts: { create: 0, update: 0, skip: 0, errors: 1 } };
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    return { rows, errors: [{ row: 0, message: `Too many rows (${rawRows.length}). The limit is ${MAX_IMPORT_ROWS} per import.` }], counts: { create: 0, update: 0, skip: 0, errors: 1 } };
  }
  const deptByName = new Map(ctx.departments.map(d => [d.name.trim().toLowerCase(), d]));
  const venueByName = new Map(ctx.venues.map(v => [v.name.trim().toLowerCase(), v]));
  const seenKeys = new Set();
  const seenIds = new Set();
  const counts = { create: 0, update: 0, skip: 0, errors: 0 };

  rawRows.forEach((raw, i) => {
    const rowNumber = i + 2; // sheet row (header is row 1)
    const r = normaliseHeaders(raw);
    const problems = [];
    const warnings = [];

    const title = cleanText(r.title, 200);
    if (!title) problems.push('Title is required.');

    const deptName = cleanText(r.department, 200);
    const dept = deptByName.get(deptName.toLowerCase());
    if (!deptName) problems.push('Booking Type is required.');
    else if (!dept) problems.push(`Unknown booking type "${deptName}" (add it under Admin > Booking Types first).`);

    const venueName = cleanText(r.venue, 200);
    const venue = venueByName.get(venueName.toLowerCase());
    if (!venueName) problems.push('Venue is required.');
    else if (!venue) problems.push(`Unknown venue "${venueName}" (add it under Admin > Venues first).`);

    const basisRaw = cleanText(r.dateBasis, 20).toLowerCase();
    const dateBasis = !basisRaw || basisRaw.startsWith('g') ? 'gregorian' : basisRaw.startsWith('h') ? 'hijri' : null;
    if (!dateBasis) problems.push('Date Basis must be Gregorian or Hijri.');
    let date = null; let hijriDate = null;
    if (dateBasis === 'hijri') {
      const h = resolveHijriDate(r.date, ctx.hijriOverrides || []);
      if (h.error) problems.push(h.error);
      else { date = h.gregorian; hijriDate = { day: h.day, month: h.month, year: h.year }; }
    } else if (dateBasis === 'gregorian') {
      date = normaliseDate(r.date);
      if (!date) problems.push('Date must be a valid Gregorian date as DD/MM/YYYY.');
    }
    const startSide = parseTimeSide('Start', r.start, r.startType, r.startPrayer, r.startOffset, problems);
    const endSide = parseTimeSide('End', r.end, r.endType, r.endPrayer, r.endOffset, problems);
    const start = startSide.time;
    const end = endSide.time;

    const statusRaw = cleanText(r.status, 20).toLowerCase();
    const status = statusRaw || 'confirmed';
    if (!STATUSES.includes(status)) problems.push(`Status must be one of ${STATUSES.join(', ')}.`);
    const visRaw = cleanText(r.visibility, 20).toLowerCase();
    const visibility = visRaw || 'public';
    if (!VISIBILITIES.includes(visibility)) problems.push('Visibility must be public or private.');

    const contactEmail = cleanText(r.contactEmail, 200);
    if (contactEmail && !EMAIL_RE.test(contactEmail)) problems.push('Contact email is not a valid email address.');

    let startAt = null; let endAt = null;
    if (date && (startSide.prayer || endSide.prayer) && (start || startSide.prayer) && (end || endSide.prayer)) {
      const r2 = resolvePrayerInstants(date, { start, end, startPrayer: startSide.prayer, endPrayer: endSide.prayer });
      if (r2) {
        startAt = r2.startAt; endAt = r2.endAt;
        if (toOrgTimeParts(endAt).dateStr !== date) warnings.push('Ends the next day (overnight).');
      } else problems.push('Could not calculate the prayer time for this date.');
    } else if (date && start && end) {
      startAt = localToUtcIso(date, start);
      let endDate = date;
      if (end <= start) { endDate = nextDayKey(date); warnings.push('End is not after start: treated as ending the next day (overnight).'); }
      endAt = localToUtcIso(endDate, end);
    }

    const id = cleanText(r.id, 40);
    let audience;
    try{const raw=cleanText(r.audience,40);const value=Object.entries(AUDIENCES).find(([key,label])=>key===raw.toLowerCase()||label.toLowerCase()===raw.toLowerCase())?.[0]||raw||ctx.existingById[id]?.audience;audience=normalizeAudience(value);const invalid=audienceError(venue,audience);if(invalid)problems.push(invalid);}catch(error){problems.push(error.message);}

    if (id && !/^[A-Za-z0-9_-]{1,40}$/.test(id)) problems.push('Id may only contain letters, numbers, - and _.');
    if (id && seenIds.has(id)) problems.push(`Id "${id}" appears more than once in the file.`);

    if (problems.length) {
      errors.push({ row: rowNumber, message: problems.join(' ') });
      counts.errors += 1;
      return;
    }

    let action = 'create';
    if (id) seenIds.add(id);
    if (id && ctx.existingById[id]) {
      action = 'update';
    } else {
      if (id) warnings.push(`Id "${id}" was not found; a new booking will be created.`);
      const key = `${venue.id}|${startAt}|${endAt}|${title.toLowerCase()}`;
      if (ctx.existingKeys.has(key) || seenKeys.has(key)) {
        action = 'skip';
        warnings.push('Duplicate of an existing booking (same title, venue and time): skipped.');
      }
      seenKeys.add(key);
    }
    counts[action] += 1;
    rows.push({
      row: rowNumber, action, warnings,
      id: action === 'update' ? id : null,
      data: {
        title, audience, departmentId: dept.id, departmentName: dept.name,
        venueId: venue.id, venueName: venue.name,
        startAt, endAt, status, visibility,
        dateBasis: dateBasis || 'gregorian', hijriDate,
        timeMode: 'custom',
        startPrayer: startSide.prayer, endPrayer: endSide.prayer,
        speakerName: cleanText(r.speakerName, 200),
        programDetails: cleanText(r.programDetails, 2000),
        contactName: cleanText(r.contactName, 200),
        contactEmail,
        contactPhone: cleanText(r.contactPhone, 50),
        notes: cleanText(r.notes, 2000)
      }
    });
  });

  return { rows, errors, counts };
}

async function completeImport({ commit, refresh, audit, logError }) {
  let stage = 'commit';
  try {
    await commit();
    stage = 'conflict-refresh';
    await refresh();
    stage = 'summary-audit';
    await audit();
  } catch (error) {
    const code = typeof error?.code === 'number' && Number.isFinite(error.code)
      ? error.code
      : typeof error?.code === 'string' && /^[a-z0-9._/-]{1,64}$/i.test(error.code) ? error.code : null;
    const type = typeof error?.name === 'string' && /^[a-z0-9._-]{1,64}$/i.test(error.name) ? error.name : 'Error';
    logError({ stage, code, type });
    throw new HttpsError('internal', 'Import could not be confirmed. Some or all bookings may already have been saved. Check Bookings before importing this file again.');
  }
}

module.exports = {
  validateImportRows, normaliseDate, resolveHijriDate, normaliseTime, cleanText, importIds, MAX_IMPORT_ROWS, completeImport
};
