import {AUDIENCES} from '../utils/audience.js';
import {prayerLabel} from '../utils/prayerTimes.js';
// Pure data model for the monthly PDF calendar (no DOM/canvas) so it can be unit tested.
import { HIJRI_MONTHS, getHijriParts } from './hijriService.js';
import { buildGregorianMonthGrid, buildHijriMonthGrid } from '../utils/hijriCalendarGrid.js';
// Same org-timezone conversions as utils/dateUtils.js (kept local so this module stays Node-testable).
const ORG_TZ = 'Australia/Sydney';
const dateKeyInOrgTz = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: ORG_TZ });
const timeKeyInOrgTz = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: ORG_TZ, hour: '2-digit', minute: '2-digit', hour12: false });

// Short transliterations used on the printed calendar (the in-app names are longer).
export const PDF_HIJRI_NAMES = {
  1: { en: 'Muharram', ar: 'محرم' },
  2: { en: 'Safar', ar: 'صفر' },
  3: { en: 'Rabi Awwal', ar: 'ربيع الأول' },
  4: { en: 'Rabi Sani', ar: 'ربيع الثاني' },
  5: { en: 'Jumada Awwal', ar: 'جمادى الأولى' },
  6: { en: 'Jumada Sani', ar: 'جمادى الآخرة' },
  7: { en: 'Rajab', ar: 'رجب' },
  8: { en: 'Shaban', ar: 'شعبان' },
  9: { en: 'Ramadan', ar: 'رمضان' },
  10: { en: 'Shawwal', ar: 'شوال' },
  11: { en: 'Dhul Qadah', ar: 'ذو القعدة' },
  12: { en: 'Dhul Hijjah', ar: 'ذو الحجة' }
};

const DOW3 = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'];
const G_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

export function to12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

const keyToDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };

function hijriName(month) { return PDF_HIJRI_NAMES[month]?.en || HIJRI_MONTHS.find(m => m.value === month)?.name || ''; }

export function programmeDescription(event) {
  const time=to12h(timeKeyInOrgTz(event.startAt));
  const prayer=event.startPrayer;
  const offset=Number(prayer?.offset)||0;
  const start=event.allDay?'All day':prayer?.key?`${prayerLabel(prayer.key)}${offset?` ${offset>0?'+':'-'}${Math.abs(offset)} min`:''} (${time})`:time;
  return {title:event.title||'Untitled',detail:[`Programme starts: ${start}`,AUDIENCES[event.audience||'family']||'Family Event',event.speakerName?`Speaker: ${event.speakerName}`:''].filter(Boolean).join(' · '),programDetails:event.programDetails||'',department:event.departmentName||'',departmentId:event.departmentId||null,pending:event.status==='pending'};
}
export function programmeDates(key,overrides=[]) {
 const d=keyToDate(key),h=getHijriParts(key,overrides);
 return {hijriDate:h.year?`${h.day}${ordinalSuffix(h.day)} ${hijriName(h.month)} ${h.year} AH`:'Hijri date unavailable',gregorianDate:`${DOW3[d.getDay()]}, ${d.getDate()}${ordinalSuffix(d.getDate())} ${G_MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}`};
}

/**
 * @param {object} p
 * @param {Array}  p.events   events already filtered by the caller (masked/private-for-public ones are dropped here too)
 * @param {'gregorian'|'hijri'} p.basis
 * @param {number} [p.year] [p.month] Gregorian year and 0-based month (basis=gregorian)
 * @param {number} [p.hYear] [p.hMonth] Hijri year and 1-based month (basis=hijri)
 */
export function buildPdfModel({ events, basis, year, month, hYear, hMonth, overrides = [] }) {
  const grid = basis === 'hijri'
    ? buildHijriMonthGrid(hYear, hMonth, overrides)
    : buildGregorianMonthGrid(year, month, overrides);
  const days = grid.cells.filter(c => c.inMonth);
  const keys = new Set(days.map(c => c.key));

  // Dominant Hijri month/year (Gregorian basis) and the Hijri span it covers.
  const tally = new Map();
  for (const c of days) {
    if (!c.hijri.year) continue;
    const k = `${c.hijri.year}-${c.hijri.month}`;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  const dominant = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split('-').map(Number) || [hYear, hMonth];
  const first = days[0], last = days[days.length - 1];

  let titleWords, pill, tagline, footerLabel, arabic;
  if (basis === 'hijri') {
    const nm = hijriName(hMonth);
    titleWords = nm.toUpperCase().split(' ');
    arabic = PDF_HIJRI_NAMES[hMonth]?.ar || '';
    const gy = first.date.getFullYear();
    pill = `${hYear} / ${gy}`;
    const a = `${G_MONTHS[first.date.getMonth()].slice(0, 3)} ${gy}`;
    const b = `${G_MONTHS[last.date.getMonth()].slice(0, 3)} ${last.date.getFullYear()}`;
    tagline = (a === b ? a : `${a} – ${b}`).toUpperCase();
    footerLabel = `${nm} - ${hYear}/${gy}`;
  } else {
    titleWords = [G_MONTHS[month].toUpperCase()];
    arabic = PDF_HIJRI_NAMES[dominant[1]]?.ar || '';
    pill = `${year} / ${dominant[0]}`;
    const a = first.hijri.year ? `${hijriName(first.hijri.month)} ${first.hijri.year}` : '';
    const b = last.hijri.year ? `${hijriName(last.hijri.month)} ${last.hijri.year}` : '';
    tagline = (a === b ? `${a} AH` : `${a} – ${b} AH`).toUpperCase();
    footerLabel = `${G_MONTHS[month]} - ${year}/${dominant[0]}`;
  }

  const byKey = new Map();
  for (const e of events) {
    if (e.masked) continue;
    const key = dateKeyInOrgTz(e.startAt);
    if (!keys.has(key)) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }

  const rows = [...byKey.keys()].sort().map(key => {
    const d = keyToDate(key);
    const h = getHijriParts(key, overrides);
    const list = byKey.get(key).sort((a, b) => a.startAt.localeCompare(b.startAt));
    return {
      key,
      hijri: h.year ? { day: h.day, suffix: ordinalSuffix(h.day), month: hijriName(h.month) } : null,
      greg: { dow: DOW3[d.getDay()], day: d.getDate(), suffix: ordinalSuffix(d.getDate()), month: G_MONTHS[d.getMonth()].slice(0, 3) },
      ...programmeDates(key,overrides),
      events: list.map(programmeDescription)
    };
  });

  // Year-sheet style fields for the "Events Calendar" template: month grid with event days highlighted.
  const isHijri = basis === 'hijri';
  const weeks = [];
  for (let i = 0; i < grid.cells.length; i += 7) {
    weeks.push(grid.cells.slice(i, i + 7).map(c => (c.inMonth ? sheetCell(c, isHijri, byKey.has(c.key)) : null)));
  }
  const gYears = [...new Set(days.map(c => c.date.getFullYear()))];
  const sheet = {
    name: isHijri ? hijriName(hMonth) : G_MONTHS[month],
    sub: isHijri
      ? rangeLabel(G_MONTHS[first.date.getMonth()], G_MONTHS[last.date.getMonth()])
      : rangeLabel(hijriName(first.hijri.month), hijriName(last.hijri.month)),
    yearLine: isHijri
      ? `${hYear} AH \u00b7 ${gYears.join(' \u2013 ')}`
      : `${year} \u00b7 ${[...new Set(days.map(c => c.hijri.year).filter(Boolean))].join(' \u2013 ')} AH`,
    weeks: weeks.filter(w => w.some(Boolean)),
    notes: dstNotes(days),
    allPrograms: rows.length > 0 && rows.every(r => r.events.every(e => e.department.trim().toLowerCase() === 'mwa programs'))
  };

  return { basis, titleWords, arabic, pill, tagline, footerLabel, rows, sheet, eventCount: rows.reduce((n, r) => n + r.events.length, 0) };
}

// ── Full-year calendar (Gregorian or Hijri year, IHC-style 3×4 grid) ─────────

// Sydney UTC offset label (e.g. "GMT+10") around local midday — used to flag daylight-saving changes.
const offsetFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ORG_TZ, timeZoneName: 'shortOffset' });
function sydneyOffset(key) {
  const [y, m, d] = key.split('-').map(Number);
  const label = offsetFmt.formatToParts(new Date(Date.UTC(y, m - 1, d, 2))).find(p => p.type === 'timeZoneName').value;
  const [, sign, hh, mm] = label.match(/([+-])(\d+)(?::(\d+))?/) || [, '+', '0', '0'];
  return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm || 0));
}

// Short Hijri month names for the small secondary line in Gregorian-year cells.
const HIJRI_SHORT = { 1: 'Muh', 2: 'Saf', 3: 'Rab I', 4: 'Rab II', 5: 'Jum I', 6: 'Jum II', 7: 'Raj', 8: 'Sha', 9: 'Ram', 10: 'Shw', 11: 'Dhq', 12: 'Dhj' };
// One printed day cell: the basis day large, the other calendar's date beneath.
function sheetCell(c, isHijri, highlighted) {
  const day = isHijri ? c.hijri.day : c.date.getDate();
  const small = isHijri
    ? `${String(c.date.getDate()).padStart(2, '0')} ${G_MONTHS[c.date.getMonth()].slice(0, 3)}`
    : (c.hijri.year ? `${String(c.hijri.day).padStart(2, '0')} ${HIJRI_SHORT[c.hijri.month]}` : '');
  return { key: c.key, big: String(day).padStart(2, '0'), small, highlighted };
}

// Sydney daylight-saving changes within a run of in-month cells.
function dstNotes(inMonth) {
  const notes = [];
  for (let i = 1; i < inMonth.length; i++) {
    const before = sydneyOffset(inMonth[i - 1].key), after = sydneyOffset(inMonth[i].key);
    if (before === after) continue;
    const d = inMonth[i].date;
    notes.push(`Daylight saving ${after > before ? 'starts' : 'ends'} ${d.getDate()} ${G_MONTHS[d.getMonth()].slice(0, 3)}, ${after > before ? '2am' : '3am'}`);
  }
  return notes;
}

// Collapses the same program on consecutive days into one line ("1–10 Majlis").
function compactYearEntries(entries) {
  const out = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (prev && prev.title === e.title && prev.time === e.time && prev.to === e.day - 1) { prev.to = e.day; continue; }
    out.push({ from: e.day, to: e.day, title: e.title, time: e.time });
  }
  return out.map(e => ({ days: e.from === e.to ? String(e.from) : `${e.from}\u2013${e.to}`, text: e.time ? `${e.title} \u00b7 ${e.time}` : e.title }));
}

const rangeLabel = (a, b) => (a === b ? a : `${a} - ${b}`);

/**
 * Model for the one-page full-year calendar (IHC-style 3×4 grid).
 *   basis 'gregorian': January–December of `year`; Gregorian day large, Hijri date beneath.
 *   basis 'hijri':     Muharram–Dhul Hijjah of `hYear`; Hijri day large, Gregorian date beneath.
 * Program days are highlighted and listed under each month, numbered by the month's own day.
 */
export function buildYearPdfModel({ events, basis = 'gregorian', year, hYear, overrides = [] }) {
  const isHijri = basis === 'hijri';
  const grids = Array.from({ length: 12 }, (_, i) => (isHijri ? buildHijriMonthGrid(hYear, i + 1, overrides) : buildGregorianMonthGrid(year, i, overrides)));
  const byKey = new Map();
  for (const e of events) {
    if (e.masked) continue;
    const key = dateKeyInOrgTz(e.startAt);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }
  let eventCount = 0;
  const gYears = new Set(), hYears = new Set();

  const months = grids.map((grid, idx) => {
    const weeks = [];
    const entries = [];
    const programmes = [];
    const inMonth = grid.cells.filter(c => c.inMonth);
    for (let i = 0; i < grid.cells.length; i += 7) {
      weeks.push(grid.cells.slice(i, i + 7).map(c => {
        if (!c.inMonth) return null;
        gYears.add(c.date.getFullYear());
        if (c.hijri.year) hYears.add(c.hijri.year);
        const day = isHijri ? c.hijri.day : c.date.getDate();
        const list = (byKey.get(c.key) || []).slice().sort((a, b) => a.startAt.localeCompare(b.startAt));
        for (const e of list) {
          entries.push({ day, title: e.title || 'Untitled', time: e.allDay ? '' : to12h(timeKeyInOrgTz(e.startAt)) });
          programmes.push({...programmeDescription(e),...programmeDates(c.key,overrides),id:e.id||`${c.key}-${programmes.length}`});
          eventCount += 1;
        }
        return sheetCell(c, isHijri, list.length > 0);
      }));
    }
    const notes = dstNotes(inMonth);
    const first = inMonth[0], last = inMonth[inMonth.length - 1];
    const sub = isHijri
      ? rangeLabel(G_MONTHS[first.date.getMonth()], G_MONTHS[last.date.getMonth()])
      : rangeLabel(hijriName(first.hijri.month), hijriName(last.hijri.month));
    return { name: isHijri ? hijriName(idx + 1) : G_MONTHS[idx], sub, weeks: weeks.filter(w => w.some(Boolean)), list: compactYearEntries(entries), programmes, notes };
  });

  const span = set => { const v = [...set].sort((a, b) => a - b); return v.length > 1 ? `${v[0]} \u2013 ${v[v.length - 1]}` : String(v[0] || ''); };
  return {
    basis: isHijri ? 'hijri' : 'gregorian',
    year: isHijri ? hYear : year,
    title: String(isHijri ? hYear : year),
    subtitle: isHijri ? `Year ${span(gYears)}` : `Hijri ${span(hYears)}`,
    listNote: isHijri ? 'Highlighted dates are MWA Program dates, listed beneath each Hijri month.' : 'Highlighted dates are MWA Program dates, listed beneath each month.',
    months,
    eventCount
  };
}
/** Month list helpers for the picker UI. */
export const GREGORIAN_MONTH_NAMES = G_MONTHS;
export const PDF_HIJRI_MONTH_OPTIONS = Object.entries(PDF_HIJRI_NAMES).map(([v, n]) => ({ value: Number(v), name: n.en }));
