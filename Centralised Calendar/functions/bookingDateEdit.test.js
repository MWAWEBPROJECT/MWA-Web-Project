const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceDateUpdate } = require('./bookingDateEdit');
const { adjustedIslamicToGregorian, getHijriMonthLength } = require('./hijriService');
const key = iso => iso.slice(0, 10);
const source = { day: 5, month: 1, year: 1449 };
const dateOf = h => { const g = adjustedIslamicToGregorian(h.year, h.month, h.day, []); return `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`; };
const before = { dateBasis: 'hijri', hijriDate: source, startAt: `${dateOf(source)}T10:00:00Z`, endAt: `${dateOf(source)}T11:00:00Z` };

test('changing a Hijri day keeps the event Hijri anchored', () => {
  const next = { ...source, day: 6 };
  assert.deepEqual(sourceDateUpdate(before, { dateBasis: 'hijri', hijriDate: next }, `${dateOf(next)}T10:00:00Z`, [], 'single', key), { dateBasis: 'hijri', hijriDate: next });
});
test('switching to Gregorian explicitly detaches the Hijri source even without moving the date', () => {
  assert.deepEqual(sourceDateUpdate(before, { dateBasis: 'gregorian' }, before.startAt, [], 'single', key), { dateBasis: 'gregorian', hijriDate: null });
});
test('switching a Gregorian event to Hijri stores its chosen source date', () => {
  const gregorian = { dateBasis: 'gregorian', startAt: before.startAt };
  assert.deepEqual(sourceDateUpdate(gregorian, { dateBasis: 'hijri', hijriDate: source }, before.startAt, [], 'single', key), { dateBasis: 'hijri', hijriDate: source });
});
test('rejects invalid or mismatched Hijri dates', () => {
  const invalid = { day: getHijriMonthLength(1449, 1, []) + 1, month: 1, year: 1449 };
  assert.throws(() => sourceDateUpdate(before, { dateBasis: 'hijri', hijriDate: invalid }, before.startAt, [], 'single', key), /valid Hijri/);
  assert.throws(() => sourceDateUpdate(before, { dateBasis: 'hijri', hijriDate: source }, '2020-01-01T10:00:00Z', [], 'single', key), /do not match/);
});
test('series-wide edits cannot replace the source date', () => {
  assert.throws(() => sourceDateUpdate({ ...before, seriesId: 'series' }, { dateBasis: 'gregorian' }, before.startAt, [], 'all', key), /this occurrence only/);
});
