const test = require('node:test');
const assert = require('node:assert/strict');
const { canMergeOccurrence, planRecurringConflicts } = require('./recurringConflictPlan');
const event = { index: 2, startAt: '2027-03-10T08:00:00Z', endAt: '2027-03-10T10:00:00Z' };
const other = { id: 'old', title: 'Existing Majlis', startAt: '2027-03-10T09:00:00Z', endAt: '2027-03-10T11:00:00Z', venueId: 'main', departmentName: 'MWA Programs', status: 'confirmed' };
const refs = [{ id: 'new-1' }, { id: 'new-2' }];
const occurrences = [{ ...event, index: 1, startAt: '2027-03-09T08:00:00Z', endAt: '2027-03-09T10:00:00Z' }, event];
const overlaps = { details: new Map([['new-1', []], ['new-2', [other]]]) };
test('requires an explicit choice for every conflicting occurrence', () => {
  assert.throws(() => planRecurringConflicts(occurrences, refs, overlaps, [], 'main', 'MWA Programs'), /Choose how/);
  assert.deepEqual(planRecurringConflicts(occurrences, refs, overlaps, [{ index: 2, action: 'skip' }], 'main', 'MWA Programs').map(row => row.action), ['create', 'skip']);
});
test('merge choice requires one current, overlapping MWA programme in the same venue', () => {
  assert.equal(canMergeOccurrence(event, other, 'main', 'MWA Programs'), true);
  assert.deepEqual(planRecurringConflicts(occurrences, refs, overlaps, [{ index: 2, action: 'merge', conflictId: 'old' }], 'main', 'MWA Programs').map(row => row.action), ['create', 'merge']);
  assert.throws(() => planRecurringConflicts(occurrences, refs, overlaps, [{ index: 2, action: 'merge', conflictId: 'different' }], 'main', 'MWA Programs'), /cannot be merged/);
  assert.equal(canMergeOccurrence(event, { ...other, venueId: 'shed' }, 'main', 'MWA Programs'), false);
  assert.equal(canMergeOccurrence(event, { ...other, startAt: '2027-03-10T11:00:00Z' }, 'main', 'MWA Programs'), false);
});
test('a clash that cannot merge can remain private and pending for scheduling review', () => {
  const differentVenue = { ...other, venueId: 'shed' };
  const scope = { details: new Map([['new-1', []], ['new-2', [differentVenue]]]) };
  assert.deepEqual(planRecurringConflicts(occurrences, refs, scope, [{ index: 2, action: 'review' }], 'main', 'MWA Programs').map(row => row.action), ['create', 'review']);
});
test('rejects stale choices and a series that would create nothing', () => {
  assert.throws(() => planRecurringConflicts(occurrences, refs, overlaps, [{ index: 1, action: 'skip' }, { index: 2, action: 'skip' }], 'main', 'MWA Programs'), /conflicts changed/);
  const all={details:new Map([['new-1',[other]],['new-2',[other]]])};
  assert.throws(() => planRecurringConflicts(occurrences, refs, all, [{ index: 1, action: 'skip' }, { index: 2, action: 'skip' }], 'main', 'MWA Programs'), /at least one/);
});
