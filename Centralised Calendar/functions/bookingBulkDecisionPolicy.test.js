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
test('admin may waive a same-venue buffer only with an explicit reason', () => {
  const adjacent = [{ id: 'earlier', venueId: 'hall', startAt: '2026-11-22T08:00:00Z', endAt: '2026-11-22T10:00:00Z', reason: 'Existing booking at this venue' }];
  const input = { venueId: 'hall', startAt: pending.startAt, endAt: pending.endAt, overlaps: adjacent, HttpsError };
  assert.throws(() => policy.checkApprovalConflicts({ ...input, bufferOverride: false }), /scheduling buffer/);
  assert.throws(() => policy.checkApprovalConflicts({ ...input, bufferOverride: true, note: 'ok' }), /reason of at least five/);
  assert.deepEqual(policy.checkApprovalConflicts({ ...input, bufferOverride: true, note: 'Consecutive MWA programmes' }), adjacent);
  assert.throws(() => policy.checkApprovalConflicts({ ...input, bufferOverride: true, note: 'Consecutive MWA programmes', requireNoConflict: true }), /venue conflict/);
});
test('admin waiver cannot approve real overlaps or different-area restrictions', () => {
  const same = { id: 'earlier', venueId: 'hall', startAt: '2026-11-22T09:30:00Z', endAt: '2026-11-22T10:30:00Z', reason: 'Existing booking at this venue' };
  const input = { venueId: 'hall', startAt: pending.startAt, endAt: pending.endAt, bufferOverride: true, note: 'Consecutive MWA programmes', HttpsError };
  assert.throws(() => policy.checkApprovalConflicts({ ...input, overlaps: [same] }), /actual time/);
  assert.throws(() => policy.checkApprovalConflicts({ ...input, overlaps: [{ ...same, venueId: 'precinct', endAt: pending.startAt, reason: 'Entire MWA Precinct booking' }] }), /different areas/);
});
