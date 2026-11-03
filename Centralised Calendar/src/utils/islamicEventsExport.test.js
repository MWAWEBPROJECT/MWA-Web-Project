import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { islamicEventsToImportRows, buildIslamicEventsWorkbook } from '../services/islamicEventsExport.js';
import { EXPORT_HEADERS, TEMPLATE_COLUMN_COUNT } from './excelUtils.js';
import { getHijriMonthLength } from '../services/hijriService.js';
const require = createRequire(import.meta.url);
const { validateImportRows } = require('../../functions/bookingImport.js');
const XLSX = require('xlsx');
const event = { id: 'observance-not-booking-id', name: '=Formula-like title', day: 13, month: 7, category: 'Wiladat', enabled: true };
const overrides = [{ hYear: 1448, hMonth: 7, gDate: '2026-12-12' }];
const objectRow = row => Object.fromEntries(EXPORT_HEADERS.slice(0, TEMPLATE_COLUMN_COUNT).map((header, index) => [header, row[index]]));

test('annual observances use exact import columns, saved Hijri dates, date order and blank booking details', () => {
  const rows = islamicEventsToImportRows([{ ...event, month: 12 }, event, { ...event, enabled: false }], 1448, overrides).map(objectRow);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Id, ''); assert.equal(rows[0]['Date Basis'], 'Hijri');
  assert.equal(rows[0].Date, '13/07/1448'); assert.equal(rows[0]['Gregorian Date'], '24/12/2026');
  assert.equal(rows[0]['Hijri Date'], '13/07/1448');
  for (const header of ['Booking Type', 'Venue', 'Start', 'End']) assert.equal(rows[0][header], '');
  assert.equal(rows[0].Status, 'pending'); assert.equal(rows[0].Visibility, 'private');
  assert.match(rows[0].Title, /^'=/);
  assert.throws(() => islamicEventsToImportRows([event], 2026), /Hijri year/);
});

test('short-month day 30 is retained and flagged, never moved into the next month', () => {
  const month = Array.from({ length: 12 }, (_, index) => index + 1).find(month => getHijriMonthLength(1448, month) === 29);
  const row = objectRow(islamicEventsToImportRows([{ ...event, month, day: 30 }], 1448)[0]);
  assert.equal(row.Date, `30/${String(month).padStart(2, '0')}/1448`);
  assert.equal(row['Gregorian Date'], ''); assert.match(row.Notes, /29 days/);
});

test('generated XLSX retains template sheets/dropdowns and round trips through the booking importer after completion', async () => {
  const workbook = await buildIslamicEventsWorkbook({
    events: [event], year: 1448, hijriOverrides: overrides,
    departments: [{ name: 'MWA Programs' }], venues: [{ name: 'Main Hall' }]
  });
  const buffer = await workbook.xlsx.writeBuffer(), parsed = XLSX.read(buffer, { type: 'buffer' });
  assert.deepEqual(parsed.SheetNames, ['Bookings', 'Lists', 'Instructions']);
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets.Bookings, { defval: '', raw: true });
  assert.equal(rows.length, 1, 'Formatting and validation rows must not become blank import records');
  assert.deepEqual(Object.keys(rows[0]), EXPORT_HEADERS.slice(0, TEMPLATE_COLUMN_COUNT));
  assert.equal(rows[0].Date, '13/07/1448');
  assert.equal(workbook.getWorksheet('Bookings').getCell('F2').numFmt, '@');
  assert.equal(workbook.getWorksheet('Bookings').getCell('C2').dataValidation.type, 'list');
  const ctx = { departments: [{ id: 'mwa-programs', name: 'MWA Programs' }], venues: [{ id: 'hall', name: 'Main Hall' }], existingById: {}, existingKeys: new Set(), hijriOverrides: overrides };
  assert.equal(validateImportRows(rows, ctx).errors.length, 1, 'Incomplete booking details must not be import-ready');
  const result = validateImportRows([{ ...rows[0], 'Booking Type': 'MWA Programs', Venue: 'Main Hall', Start: '18:00', End: '20:00' }], ctx);
  assert.deepEqual(result.errors, []); assert.equal(result.counts.create, 1);
  assert.deepEqual(result.rows[0].data.hijriDate, { day: 13, month: 7, year: 1448 });
  assert.equal(result.rows[0].data.title, event.name);
});

test('empty data and more than the import limit fail without an example-only or partial workbook', async () => {
  await assert.rejects(buildIslamicEventsWorkbook({ events: [], year: 1448 }), /No enabled/);
  await assert.rejects(buildIslamicEventsWorkbook({ events: Array.from({ length: 501 }, () => event), year: 1448 }), /500 event rows/);
});
