import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAdminEventPages } from './adminEventPages.mjs';

const booking = id => ({ id, startAt: '2025-01-01T00:00:00.000Z', endAt: '2025-01-01T01:00:00.000Z' });

test('all-years booking pages are collected completely and preserve their scope', async () => {
  const calls = [];
  const rows = Array.from({ length: 251 }, (_, i) => booking(String(i)));
  const result = await collectAdminEventPages(async input => {
    calls.push(input);
    return input.cursor ? { events: rows.slice(200), nextPageCursor: null, scope: 'all-time' }
      : { events: rows.slice(0, 200), nextPageCursor: 'next', scope: 'all-time' };
  }, { allTime: true });
  assert.deepEqual(result, rows);
  assert.deepEqual(calls, [{ allTime: true, cursor: null }, { allTime: true, cursor: 'next' }]);
});

test('page limit, invalid responses and repeated cursors fail without returning partial results', async () => {
  await assert.rejects(() => collectAdminEventPages(async () => ({
    events: [booking('1')], nextPageCursor: 'next', scope: 'all-time'
  }), { allTime: true }, { maxPages: 1 }), { code: 'bookings-too-many' });
  await assert.rejects(() => collectAdminEventPages(async () => ({
    events: [booking('1')], nextPageCursor: 'next', scope: 'all-time'
  }), { allTime: true }), /repeated a page cursor/);
  await assert.rejects(() => collectAdminEventPages(async () => ({
    events: [{ ...booking('1'), endAt: null }], nextPageCursor: null, scope: 'all-time'
  }), { allTime: true }), { code: 'bookings-invalid' });
  await assert.rejects(() => collectAdminEventPages(async () => ({}), { allTime: true }), /invalid page/);
  await assert.rejects(() => collectAdminEventPages(async () => ({ events: [booking('1')], nextPageCursor: null }), { allTime: true }), { code: 'bookings-incompatible' });
  await assert.rejects(() => collectAdminEventPages(async () => ({ events: Array.from({ length: 201 }, () => booking('1')), scope: 'all-time' }), { allTime: true }), /invalid page/);
});

test('cancellation after an in-flight page prevents subsequent calls', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(() => collectAdminEventPages(async () => {
    calls += 1;
    controller.abort();
    return { events: [booking('1')], nextPageCursor: 'next' };
  }, { allTime: true }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
