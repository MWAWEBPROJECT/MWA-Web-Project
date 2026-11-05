const test = require('node:test');
const assert = require('node:assert/strict');
const { validateImportRows, normaliseDate, resolveHijriDate, importIds } = require('./bookingImport');
const { adjustedGregorianToIslamic } = require('./hijriService');
const { toOrgTimeParts } = require('./dateUtils');

const ctx = (extra = {}) => ({
  departments: [{ id: 'd1', name: 'Youth' }], venues: [{ id: 'v1', name: 'Main Hall' }],
  existingById: {}, existingKeys: new Set(), hijriOverrides: [], ...extra
});
const row = (o) => ({ Title: 'T', Department: 'Youth', Venue: 'Main Hall', Start: '10:30', End: '15:00', ...o });

test('dd/mm/yyyy is day-first: 05/10/2026 is 5 October, never 10 May', () => {
  assert.equal(normaliseDate('05/10/2026'), '2026-10-05');
  assert.equal(normaliseDate('13/01/2026'), '2026-01-13');
  assert.equal(normaliseDate('01/13/2026'), null);
  assert.equal(normaliseDate('2026-10-05'), '2026-10-05');
  assert.equal(normaliseDate('31/02/2026'), null);
});

test('Excel serials resolve to the right Gregorian date', () => {
  assert.equal(normaliseDate(46300), '2026-10-05'); // 2026-10-05 serial
  const r = validateImportRows([row({ Date: 46300 })], ctx());
  assert.equal(r.errors.length, 0);
  assert.equal(toOrgTimeParts(r.rows[0].data.startAt).timeStr, '10:30');
});

test('Gregorian row defaults basis and stores Sydney instants', () => {
  const r = validateImportRows([row({ Date: '05/10/2026' })], ctx());
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].data.dateBasis, 'gregorian');
  assert.equal(r.rows[0].data.hijriDate, null);
  assert.equal(r.rows[0].data.startAt, '2026-10-04T23:30:00.000Z'); // AEDT +11
});

test('Hijri row resolves to Gregorian via the anchoring rules and keeps hijriDate', () => {
  const h = adjustedGregorianToIslamic(2026, 10, 5, []);
  const dmy = `${String(h.day).padStart(2, '0')}/${String(h.month).padStart(2, '0')}/${h.year}`;
  const r = validateImportRows([row({ 'Date Basis': 'Hijri', Date: dmy })], ctx());
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].data.dateBasis, 'hijri');
  assert.deepEqual(r.rows[0].data.hijriDate, { day: h.day, month: h.month, year: h.year });
  assert.equal(r.rows[0].data.startAt, '2026-10-04T23:30:00.000Z');
});

test('Hijri row follows the moon-sighting adjustment', () => {
  const h = adjustedGregorianToIslamic(2026, 10, 5, []);
  const ov = [{ hYear: h.year, hMonth: h.month, gDate: '2026-09-13' }];
  const base = resolveHijriDate(`01/${h.month}/${h.year}`, []);
  const adj = resolveHijriDate(`01/${h.month}/${h.year}`, ov);
  assert.notEqual(base.gregorian, adj.gregorian);
});

test('Hijri validation: month length, month range, numeric serial rejected', () => {
  const bad = (d) => validateImportRows([row({ 'Date Basis': 'Hijri', Date: d })], ctx()).errors.length;
  assert.equal(bad('31/01/1448'), 1);
  assert.equal(bad('01/13/1448'), 1);
  assert.equal(bad('01/01/1448') , 0);
  assert.equal(bad(46300), 1);
  assert.equal(validateImportRows([row({ 'Date Basis': 'Julian', Date: '01/01/2026' })], ctx()).errors.length, 1);
});

test('legacy ISO dates still accepted for Gregorian rows', () => {
  assert.equal(validateImportRows([row({ Date: '2026-10-05' })], ctx()).errors.length, 0);
});

test('error message names the DD/MM/YYYY format', () => {
  const r = validateImportRows([row({ Date: 'tomorrow' })], ctx());
  assert.match(r.errors[0].message, /DD\/MM\/YYYY/);
});

test('importIds accepts workbook header variants and returns unique bounded IDs', () => {
  assert.deepEqual(importIds([{ ID: ' event-1 ' }, { booking_id: 'event-1' }, { Id: 'bad/id' }, { Title: 'no id' }]), ['event-1']);
});
