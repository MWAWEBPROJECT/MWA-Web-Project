// Pure helpers for the admin Excel (.xlsx) import/export. No imports so they are testable in Node.
// Header names match functions/bookingImport.js aliases (round-trip safe).

export const EXPORT_HEADERS = [
  'Id', 'Title', 'Booking Type', 'Venue', 'Date Basis', 'Date',
  'Start Type', 'Start', 'Start Prayer', 'Start Offset', 'End Type', 'End', 'End Prayer', 'End Offset',
  'Gregorian Date', 'Hijri Date', 'Status', 'Visibility', 'Speaker Name', 'Program Details',
  'Contact Name', 'Contact Email', 'Contact Phone', 'Notes', 'Audience', 'Overlap', 'Series Id', 'Recurrence'
];

/** Columns in the import template (everything except the informational export-only tail). */
export const TEMPLATE_COLUMN_COUNT = EXPORT_HEADERS.indexOf('Audience') + 1;

export const PRAYER_NAMES = ['Fajr', 'Zohrain', 'Asr', 'Maghreb', 'Isha'];
const prayerName = (p) => (p && p.key ? PRAYER_NAMES.find(n => n.toLowerCase() === p.key) || p.key : '');
const timeSide = (p) => (p && p.key ? ['Variable', prayerName(p), Number(p.offset) || 0] : ['Fixed', '', '']);

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

/** Neutralise spreadsheet formula injection: text starting with = + - @ (or tab/CR) gets a leading apostrophe. */
export function sanitizeCell(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function recurrenceSummary(e) {
  const r = e.recurrence;
  if (!e.seriesId) return '';
  if (!r) return `Series ${e.seriesIndex || ''}/${e.seriesCount || ''}`.trim();
  const unit = { day: 'day', week: 'week', month: 'month' }[r.frequency] || r.frequency;
  const n = Number(r.repeatEvery) > 1 ? `${r.repeatEvery} ${unit}s` : unit;
  const end = r.endMode === 'count' ? `${r.count} times` : r.endMode === 'date' ? `until ${r.endDate}` : '';
  return `Every ${n} (${r.basis}) ${end} #${e.seriesIndex || '?'}/${e.seriesCount || '?'}`.replace(/\s+/g, ' ').trim();
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' (the import/export date format). */
export function toDmy(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** {day,month,year} -> 'DD/MM/YYYY' (Hijri, AH). */
export function hijriToDmy(h) {
  return h && h.year ? `${pad2(h.day)}/${pad2(h.month)}/${h.year}` : '';
}

/**
 * fmt = { dateKey(iso), timeKey(iso), hijriParts(iso) } injected so this stays framework/host-tz free.
 * 'Date' is in the row's Date Basis (Hijri-anchored bookings export their Hijri source date), so
 * exporting then importing round-trips. 'Gregorian Date' / 'Hijri Date' are informational (ignored on import).
 * Dates are exported as text so Excel cannot reinterpret dd/mm as mm/dd.
 */
export function bookingsToRows(events, fmt) {
  return events.map(e => {
    const isHijri = e.dateBasis === 'hijri' || e.dateBasis === 'h';
    const parts = (isHijri && e.hijriDate && e.hijriDate.year) ? e.hijriDate : fmt.hijriParts(e.startAt);
    const gDmy = toDmy(fmt.dateKey(e.startAt));
    const hDmy = hijriToDmy(parts);
    return [
      e.id, e.title, e.departmentName || '', e.venueName || '',
      isHijri && hDmy ? 'Hijri' : 'Gregorian', isHijri && hDmy ? hDmy : gDmy,
      timeSide(e.startPrayer)[0], fmt.timeKey(e.startAt), timeSide(e.startPrayer)[1], timeSide(e.startPrayer)[2],
      timeSide(e.endPrayer)[0], fmt.timeKey(e.endAt), timeSide(e.endPrayer)[1], timeSide(e.endPrayer)[2],
      gDmy, hijriToDmy(fmt.hijriParts(e.startAt)),
      e.status, e.visibility || 'private', e.speakerName || '', e.programDetails || '',
      e.contactName || '', e.contactEmail || '', e.contactPhone || '', e.notes || '', ({family:'Family Event',gents:'Gents only',ladies:'Ladies only',kids:'Kids only'})[e.audience||'family'],
      e.hasConflict ? 'yes' : '', e.seriesId || '', recurrenceSummary(e)
    ].map(sanitizeCell);
  });
}

export const IMPORT_INSTRUCTIONS = [
  ['MWA Central Calendar - booking import'],
  [''],
  ['Fill in the "Bookings" sheet (keep the header row). Required: Title, Booking Type, Venue, Date, and Start / End (or a prayer when the type is Variable).'],
  ['Date format is DD/MM/YYYY (day first) for BOTH Gregorian and Hijri dates, e.g. 05/10/2026 is 5 October 2026.'],
  ['Date Basis: Gregorian (default) or Hijri. A Hijri row\'s Date is Hijri day/month/year (AH), e.g. 23/04/1448; it stays fixed to that Hijri day when the moon-sighting adjustment changes.'],
  ['Format the Date column as Text (or type it with Excel\'s DD/MM/YYYY date format for Gregorian). Hijri dates must be text.'],
  ['Start / End are 24-hour Australia/Sydney times (HH:MM). End earlier than Start means the booking ends the next day.'],
  ['Start Type / End Type: Fixed (default) uses the Start / End time. Variable uses a prayer time instead: leave the time blank, choose Start Prayer / End Prayer (Fajr, Zohrain, Asr, Maghreb, Isha) and optionally an Offset in minutes (e.g. 15 or -30, max 360). Prayer times are calculated for Muhammadi Welfare Association, Kemps Creek NSW, on the booking date.'],
  ['Audience: Family Event (default for new rows), Gents only, Ladies only or Kids only. Halls 4, 5 and 6 require Ladies only. Blank audience on an existing Id preserves its saved audience.'],
  ['Speaker Name and Program Details are optional (used for MWA Programs).'],
  ['Status: pending, confirmed (default), rejected or cancelled. Visibility: public (default) or private.'],
  ['Use the dropdowns for Date Basis, Booking Type, Venue, Start/End Type, Start/End Prayer, Status and Visibility. Booking Type and Venue must match existing names exactly (the lists reflect the current names when the template was downloaded). Leave Id blank to create; an existing Id updates that booking.'],
  ['Gregorian Date / Hijri Date / Overlap / Series Id / Recurrence columns are informational and ignored on import.']
];

export function templateRows() {
  return [
    EXPORT_HEADERS.slice(0, TEMPLATE_COLUMN_COUNT),
    ['', 'Example event (Gregorian)', 'Youth', 'Main Hall', 'Gregorian', '05/10/2026', 'Fixed', '10:30', '', '', 'Fixed', '15:00', '', '', '', '', 'confirmed', 'public', '', '', 'Jane Citizen', 'jane@example.com', '0400 000 000', 'Optional notes', 'Family Event'],
    ['', 'Example event (Hijri)', 'Youth', 'Main Hall', 'Hijri', '23/04/1448', 'Fixed', '10:30', '', '', 'Fixed', '15:00', '', '', '', '', 'confirmed', 'public', '', '', '', '', '', 'Date is Hijri day/month/year (AH)', 'Family Event'],
    ['', 'Overnight example', 'Youth', 'Main Hall', 'Gregorian', '10/10/2026', 'Fixed', '18:00', '', '', 'Fixed', '06:00', '', '', '', '', 'confirmed', 'public', '', '', '', '', '', 'End earlier than start = ends next day', 'Family Event'],
    ['', 'Majlis (prayer time example)', 'MWA Programs', 'Main Hall', 'Gregorian', '16/10/2026', 'Variable', '', 'Maghreb', '15', 'Fixed', '21:30', '', '', '', '', 'confirmed', 'public', 'Speaker name', 'Program details', '', '', '', 'Starts 15 min after Maghreb', 'Family Event']
  ];
}
export function filterByDateRange(events, fromKey, toKey, dateKey) {
  return events.filter(e => {
    const k = dateKey(e.startAt);
    return (!fromKey || k >= fromKey) && (!toKey || k <= toKey);
  });
}
