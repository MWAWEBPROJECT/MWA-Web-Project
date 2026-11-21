const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./bookingBulkDecisionPolicy');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const pending = { status: 'pending', venueId: 'hall', startAt: '2026-11-22T10:00:00Z', endAt: '2026-11-22T12:00:00Z' };

test('bulk approval rejects a live conflict even if the row looked clear when selected', () => {
  assert.throws(() => policy.checkConflict([{ id: 'other', reason: 'Existing booking at this venue' }], true, HttpsError), { code: 'failed-precondition' });
  assert.doesNotThrow(() => policy.checkConflict([], true, HttpsError));
});
test('bulk decision rejects changed status or booking slot before writing', () => {
  policy.checkBulkRequest('pending', HttpsError);
  assert.throws(() => policy.checkBulkRequest('confirmed', HttpsError), { code: 'invalid-argument' });
  assert.throws(() => policy.checkPending({ ...pending, status: 'confirmed' }, 'pending', HttpsError), { code: 'failed-precondition' });
  assert.throws(() => policy.checkUnchanged({ ...pending, startAt: '2026-11-22T11:00:00Z' }, pending, 'pending', HttpsError), { code: 'failed-precondition' });
  assert.doesNotThrow(() => policy.checkUnchanged({ ...pending }, pending, 'pending', HttpsError));
});
test('single-booking decisions do not activate bulk validation when optional status is absent', () => {
  assert.doesNotThrow(() => policy.checkBulkRequest(undefined, HttpsError));
  assert.doesNotThrow(() => policy.checkBulkRequest(null, HttpsError));
});
