import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingDecisionPayload } from './bookingDecisionPayload.mjs';

test('single approval omits bulk-only fields, including callable-null defaults', () => {
  const single = bookingDecisionPayload({ eventId: 'one', status: 'confirmed', note: '', expectedStatus: null });
  assert.deepEqual(single, { eventId: 'one', status: 'confirmed', visibility: undefined, note: '' });
  assert.equal(Object.hasOwn(single, 'expectedStatus'), false);
  assert.equal(Object.hasOwn(single, 'requireNoConflict'), false);
});
test('bulk approval retains pending-status and conflict checks', () => {
  const bulk = bookingDecisionPayload({ eventId: 'one', status: 'confirmed', expectedStatus: 'pending', requireNoConflict: true });
  assert.equal(bulk.expectedStatus, 'pending');
  assert.equal(bulk.requireNoConflict, true);
});
