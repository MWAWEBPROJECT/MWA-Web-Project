const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeBookingCursor, decodeBookingCursor, allBookingsPage, allBookingsPageData } = require('./adminBookingQuery');

test('all-years cursor round-trips valid document IDs and rejects invalid input', () => {
  for (const id of ['id-1', 'bookings with spaces', 'é'.repeat(750)]) {
    assert.equal(decodeBookingCursor(encodeBookingCursor(id)), id);
  }
  for (const id of ['', '.', '..', 'a/b', 'a'.repeat(1501)]) {
    assert.throws(() => decodeBookingCursor(encodeBookingCursor(id)), /invalid/);
  }
  assert.throws(() => decodeBookingCursor('!!!'), /invalid/);
});

test('all-years query is bounded, ordered by document ID and returns a stable cursor', () => {
  const calls = [];
  const query = {
    orderBy(value) { calls.push(['orderBy', value]); return this; },
    startAfter(value) { calls.push(['startAfter', value]); return this; },
    limit(value) { calls.push(['limit', value]); return this; }
  };
  assert.equal(allBookingsPage(query, 'document-key', 'previous'), query);
  assert.deepEqual(calls, [['orderBy', 'document-key'], ['startAfter', 'previous'], ['limit', 201]]);
  const docs = Array.from({ length: 201 }, (_, i) => ({ id: `id${i}` }));
  const page = allBookingsPageData({ docs });
  assert.equal(page.docs.length, 200);
  assert.equal(decodeBookingCursor(page.nextPageCursor), 'id199');
  assert.equal(allBookingsPageData({ docs: docs.slice(0, 200) }).nextPageCursor, null);
});
