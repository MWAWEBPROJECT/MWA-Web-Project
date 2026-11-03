import { eventsForHijriYear } from '../utils/islamicEvents.js';
import { EXPORT_HEADERS, TEMPLATE_COLUMN_COUNT, hijriToDmy, sanitizeCell, toDmy } from '../utils/excelUtils.js';
import { buildTemplateWorkbook } from './templateService.js';

export function islamicEventsToImportRows(events, year, hijriOverrides = []) {
  if (!Number.isInteger(year) || year < 1300 || year > 1600) throw new Error('Choose a Hijri year between 1300 and 1600.');
  return eventsForHijriYear(events, year, hijriOverrides).map(event => {
    const hijriDate = hijriToDmy({ day: event.day, month: event.month, year });
    const notes = [
      `Annual Islamic observance: ${event.category}.`,
      event.notes || '',
      !event.gregorianDate ? 'No Gregorian occurrence: this Hijri month has 29 days under the saved adjustments. Review the date before importing.' : ''
    ].filter(Boolean).join(' ');
    const values = {
      Title: event.name, 'Date Basis': 'Hijri', Date: hijriDate,
      'Start Type': 'Fixed', 'End Type': 'Fixed',
      'Gregorian Date': toDmy(event.gregorianDate), 'Hijri Date': hijriDate,
      Status: 'pending', Visibility: 'private', Notes: notes
    };
    return EXPORT_HEADERS.slice(0, TEMPLATE_COLUMN_COUNT).map(header => sanitizeCell(values[header] ?? ''));
  });
}

export async function buildIslamicEventsWorkbook({ events, year, hijriOverrides = [], departments = [], venues = [] }) {
  const dataRows = islamicEventsToImportRows(events, year, hijriOverrides);
  if (!dataRows.length) throw new Error('No enabled Islamic events are available to export.');
  const workbook = await buildTemplateWorkbook({ departments, venues, dataRows });
  workbook.creator = 'Muhammadi Welfare Association';
  const instructions = workbook.getWorksheet('Instructions');
  for (const text of [
    '',
    `Islamic Events Calendar: full ${year} AH, ${dataRows.length} annual observances, in Hijri date order.`,
    'This is a preparation workbook, not a set of approved bookings. No bookings have been created by downloading it.',
    'Complete Booking Type, Venue, Start and End before importing. Id is intentionally blank so observance IDs cannot update existing bookings.',
    'Status is pending and Visibility is private as cautious defaults. Review these settings before import.',
    'Gregorian Date and Hijri Date are informational. Date Basis is Hijri, so Date remains anchored to the observance when saved moon-sighting adjustments change.',
    'Dates follow the saved community Hijri adjustments at export time; future dates remain subject to moon sighting.',
    'An observance on day 30 of a 29-day month is retained with a warning in Notes and no Gregorian date. It must be reviewed before import.',
    'Only the chosen Hijri year is exported. Importing creates individual bookings, not an automatically recurring annual observance.',
    'Calendar import validates the completed rows and flags conflicts. This workbook does not reserve a venue or send any messages.'
  ]) instructions.addRow([text]);
  return workbook;
}

export async function downloadIslamicEventsXlsx(options) {
  const workbook = await buildIslamicEventsWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = `mwa-islamic-events-${options.year}-AH-import.xlsx`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
