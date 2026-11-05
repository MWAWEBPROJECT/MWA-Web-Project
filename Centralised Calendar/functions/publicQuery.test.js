const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DAY_MS, MAX_RANGE_DAYS, MAX_RESULTS, validateRange, defaultFeedRange, civilDayRange,
  overlapsRange, encodeCursor, decodeCursor
} = require('./publicQuery');

test('public date ranges require valid increasing instants within the hard maximum', () => {
  const range = validateRange('2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z');
  assert.equal(range.from, '2027-01-01T00:00:00.000Z');
  assert.throws(() => validateRange('', '2027-01-02T00:00:00Z'));
  assert.throws(() => validateRange('2027-01-02T00:00:00Z', '2027-01-01T00:00:00Z'));
  assert.throws(() => validateRange('2027-01-01T00:00:00Z', new Date(Date.parse('2027-01-01T00:00:00Z') + (MAX_RANGE_DAYS + 1) * DAY_MS).toISOString()));
  assert.equal(MAX_RESULTS, 1000);
});

test('overlap windows retain multi-day bookings and exclude events touching only a boundary', () => {
  const from = '2027-01-02T00:00:00.000Z', to = '2027-01-03T00:00:00.000Z';
  assert.equal(overlapsRange({ startAt: '2027-01-01T20:00:00Z', endAt: '2027-01-02T04:00:00Z' }, from, to), true);
  assert.equal(overlapsRange({ startAt: '2027-01-03T00:00:00Z', endAt: '2027-01-03T04:00:00Z' }, from, to), false);
  assert.equal(overlapsRange({ startAt: '2027-01-01T20:00:00Z', endAt: '2027-01-02T00:00:00Z' }, from, to), false);
});

test('iCal uses a rolling one-year bounded range', () => {
  const range = defaultFeedRange(Date.parse('2027-01-01T12:30:00Z'));
  assert.equal(range.from, '2027-01-01T00:00:00.000Z');
  assert.equal(Date.parse(range.to) - Date.parse(range.from), MAX_RANGE_DAYS * DAY_MS);
});

test('civil day ranges use Sydney midnight boundaries across daylight-saving changes',()=>{
 assert.deepEqual(civilDayRange('2026-10-04'),{
  from:'2026-10-03T14:00:00.000Z',to:'2026-10-04T13:00:00.000Z'
 });
 assert.deepEqual(civilDayRange('2026-04-05'),{
  from:'2026-04-04T13:00:00.000Z',to:'2026-04-05T14:00:00.000Z'
 });
 assert.throws(()=>civilDayRange('2026-02-30'),/valid date/);
});

test('cursors round-trip only bounded start times and document ids',()=>{
  const cursor = encodeCursor('2027-01-02T03:04:05.000Z', 'event_123');
  assert.deepEqual(decodeCursor(cursor), { startAt: '2027-01-02T03:04:05.000Z', id: 'event_123' });
  assert.throws(() => decodeCursor('not-a-cursor'));
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(['2027-01-01', 'bad/id'])).toString('base64url')));
});
