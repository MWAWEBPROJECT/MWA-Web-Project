const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePair, mergedTitle, selectedItems } = require('./eventMergePolicy');

const first = { id: 'a', status: 'confirmed', departmentName: 'MWA Programs', venueId: 'main', startAt: '2027-06-14T09:00:00Z', endAt: '2027-06-14T11:00:00Z' };
const second = { ...first, id: 'b', status: 'pending', startAt: '2027-06-14T10:00:00Z', endAt: '2027-06-14T12:00:00Z' };

test('requires two actual overlapping MWA programmes in the same venue', () => {
  assert.doesNotThrow(() => validatePair(first, second));
  assert.throws(() => validatePair(first, { ...second, startAt: first.endAt }), /overlap/);
  assert.throws(() => validatePair(first, { ...second, venueId: 'shed' }), /same venue/);
  assert.throws(() => validatePair(first, { ...second, departmentName: 'Private Hire' }), /MWA programmes/);
});

test('combined title and programme item choices are validated', () => {
  assert.equal(mergedTitle('  Two occasions  '), 'Two occasions');
  assert.throws(() => mergedTitle('  '), /combined title/);
  assert.deepEqual(selectedItems([{ id: 'x', name: 'A' }], [{ id: 'y', name: 'B' }], ['remove:y'], 'volunteers'), [{ id: 'y', name: 'B' }]);
  assert.throws(() => selectedItems([], [], ['unknown'], 'volunteers'), /changed/);
});
