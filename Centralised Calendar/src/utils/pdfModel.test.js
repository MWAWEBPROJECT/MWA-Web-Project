import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfModel, buildYearPdfModel, ordinalSuffix, to12h } from '../services/pdfModel.js';

const ev = (id, startAt, endAt, extra = {}) => ({ id, title: id, startAt, endAt, status: 'confirmed', venueName: 'Main Hall', departmentName: 'Youth', ...extra });

test('ordinals and 12h times', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 30].map(ordinalSuffix), ['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'st', 'nd', 'th']);
  assert.equal(to12h('19:00'), '7:00 pm');
  assert.equal(to12h('00:30'), '12:30 am');
  assert.equal(to12h('12:00'), '12:00 pm');
});

test('Gregorian month: only that month, sorted, masked dropped', () => {
  const m = buildPdfModel({
    basis: 'gregorian', year: 2026, month: 8,
    events: [
      ev('b', '2026-09-22T09:00:00Z', '2026-09-22T11:00:00Z'),
      ev('a', '2026-09-13T09:00:00Z', '2026-09-13T10:00:00Z'),
      ev('out', '2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z'),
      ev('priv', '2026-09-15T09:00:00Z', '2026-09-15T10:00:00Z', { masked: true })
    ]
  });
  assert.deepEqual(m.titleWords, ['SEPTEMBER']);
  assert.deepEqual(m.rows.map(r => r.events[0].title), ['a', 'b']);
  assert.equal(m.eventCount, 2);
  assert.equal(m.rows[0].greg.dow, 'Sun');
  assert.equal(m.rows[0].greg.day, 13);
  assert.match(m.pill, /^2026 \/ 14\d\d$/);
  assert.ok(m.arabic);
});

test('Hijri month covers its own Gregorian span', () => {
  const m = buildPdfModel({
    basis: 'hijri', hYear: 1448, hMonth: 4,
    events: [ev('x', '2026-09-22T09:00:00Z', '2026-09-22T11:00:00Z'), ev('y', '2026-12-30T09:00:00Z', '2026-12-30T11:00:00Z')]
  });
  assert.deepEqual(m.titleWords, ['RABI', 'SANI']);
  assert.equal(m.pill.startsWith('1448 / 2026'), true);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].hijri.month, 'Rabi Sani');
  assert.match(m.footerLabel, /Rabi Sani - 1448\/2026/);
});

test('year model (Hijri): Muharram–Dhul Hijjah, highlighted program days, compacted ranges', () => {
  const events = [];
  for (let d = 17; d <= 26; d++) events.push(ev(`m${d}`, `2026-06-${d}T09:30:00.000Z`, `2026-06-${d}T12:00:00.000Z`, { title: 'Majlis' }));
  events.push(ev('masked', '2026-06-20T01:00:00.000Z', '2026-06-20T02:00:00.000Z', { masked: true }));
  const m = buildYearPdfModel({ events, basis: 'hijri', hYear: 1448 });
  assert.equal(m.title, '1448');
  assert.equal(m.subtitle, 'Year 2026 \u2013 2027');
  assert.equal(m.months.length, 12);
  assert.deepEqual([m.months[0].name, m.months[11].name], ['Muharram', 'Dhul Hijjah']);
  assert.equal(m.eventCount, 10);
  const muh = m.months[0];
  assert.deepEqual(muh.list, [{ days: '1\u201310', text: 'Majlis \u00b7 7:30 pm' }]);
  assert.equal(muh.weeks.flat().filter(c => c && c.highlighted).length, 10);
  assert.equal(muh.weeks.flat().find(c => c).small, '17 Jun');
  assert.match(m.listNote, /beneath each Hijri month/);
});

test('year model (Gregorian): January–December with Hijri dates beneath', () => {
  const m = buildYearPdfModel({ events: [ev('e', '2026-06-17T09:30:00.000Z', '2026-06-17T12:00:00.000Z', { title: 'Majlis' })], basis: 'gregorian', year: 2026 });
  assert.equal(m.title, '2026');
  assert.equal(m.subtitle, 'Hijri 1447 \u2013 1448');
  assert.deepEqual([m.months[0].name, m.months[11].name], ['January', 'December']);
  const june = m.months[5];
  assert.equal(june.sub, 'Dhul Hijjah - Muharram');
  assert.deepEqual(june.list, [{ days: '17', text: 'Majlis \u00b7 7:30 pm' }]);
  const cell = june.weeks.flat().find(c => c && c.key === '2026-06-17');
  assert.deepEqual([cell.big, cell.small, cell.highlighted], ['17', '01 Muh', true]);
  assert.deepEqual(m.months.flatMap(x => x.notes), ['Daylight saving ends 5 Apr, 3am', 'Daylight saving starts 4 Oct, 2am']);
});
test('month model: sheet grid for the Classic template', () => {
  const m = buildPdfModel({ events: [ev('e', '2026-10-15T08:00:00.000Z', '2026-10-15T11:00:00.000Z', { title: 'Dua e Kumail', departmentName: 'MWA Programs' })], basis: 'gregorian', year: 2026, month: 9 });
  assert.equal(m.sheet.name, 'October');
  assert.equal(m.sheet.sub, 'Rabi Sani - Jumada Awwal');
  assert.equal(m.sheet.yearLine, '2026 \u00b7 1448 AH');
  assert.equal(m.sheet.allPrograms, true);
  const cells = m.sheet.weeks.flat().filter(Boolean);
  assert.equal(cells.length, 31);
  assert.deepEqual(cells.filter(c => c.highlighted).map(c => c.key), ['2026-10-15']);
  assert.deepEqual(m.sheet.notes, ['Daylight saving starts 4 Oct, 2am']);
});

test('programme descriptions include start, audience, speaker and public details', () => {
 const events=[ev('fixed','2026-11-29T08:00:00Z','2026-11-29T10:00:00Z',{audience:'ladies',speakerName:'Guest speaker',programDetails:'Welcome\nProgramme details',notes:'INTERNAL - must not be exported'}),ev('prayer','2026-11-29T09:15:00Z','2026-11-29T11:00:00Z',{startPrayer:{key:'maghreb',offset:15},audience:'gents'})];
 const model=buildPdfModel({events,basis:'gregorian',year:2026,month:10});
 assert.match(model.rows[0].events[0].detail,/Programme starts: 7:00 pm · Ladies only · Speaker: Guest speaker/);
 assert.equal(model.rows[0].events[0].programDetails,'Welcome\nProgramme details');
 assert.match(model.rows[0].events[1].detail,/Maghreb \+15 min \(8:15 pm\)/);
 assert.match(model.rows[0].hijriDate,/1448 AH/);
 assert.equal(model.rows[0].gregorianDate,'Sun, 29th Nov 2026');
 assert.equal(JSON.stringify(model).includes('INTERNAL'),false);
 const annual=buildYearPdfModel({events,basis:'gregorian',year:2026});
 assert.equal(annual.months[10].programmes.length,2);
 assert.equal(annual.months[10].programmes[0].programDetails,'Welcome\nProgramme details');
 assert.equal(annual.months[10].programmes[0].gregorianDate,model.rows[0].gregorianDate);
});
