import test from 'node:test';
import assert from 'node:assert/strict';
import { runBulkBookingDecision } from './bulkBookingDecision.mjs';

test('bulk decisions continue after a conflict and preserve each outcome', async () => {
  const called = [];
  const items = [{ id: 'a', title: 'First', status: 'pending' }, { id: 'b', title: 'Conflict', status: 'pending' }, { id: 'c', title: 'Already done', status: 'confirmed' }, { id: 'd', title: 'Last', status: 'pending' }];
  const results = await runBulkBookingDecision(items, 'confirmed', '', async input => { called.push(input); if (input.eventId === 'b') throw Error('Venue conflict'); });
  assert.deepEqual(results.map(row => row.outcome), ['approved', 'failed', 'skipped', 'approved']);
  assert.deepEqual(called.map(row => row.eventId), ['a', 'b', 'd']);
  assert(called.every(row => row.expectedStatus === 'pending' && row.requireNoConflict));
});

test('bulk rejection passes the common reason without an approval conflict gate', async () => {
  const calls = [];
  await runBulkBookingDecision([{ id: 'a', title: 'First', status: 'pending' }], 'rejected', 'Outside programme scope', async input => calls.push(input));
  assert.equal(calls[0].note, 'Outside programme scope');
  assert.equal(calls[0].requireNoConflict, false);
});
test('bulk buffer waiver keeps per-booking server checks and cannot bypass actual overlap', async () => {
  const calls = [];
  await runBulkBookingDecision([{ id: 'a', title: 'First', status: 'pending' }], 'confirmed', 'Consecutive programmes', async input => calls.push(input), { bufferOverride: true });
  assert.equal(calls[0].bufferOverride, true);
  assert.equal(calls[0].requireNoConflict, false);
  assert.equal(calls[0].expectedStatus, 'pending');
});
