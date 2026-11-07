export const MAX_ADMIN_PAGES = 50;

export async function collectAdminEventPages(call, params, { signal, maxPages = MAX_ADMIN_PAGES } = {}) {
  const events = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    if (signal?.aborted) throw new DOMException('Booking loading cancelled.', 'AbortError');
    const result = await call({ ...params, cursor });
    if (signal?.aborted) throw new DOMException('Booking loading cancelled.', 'AbortError');
    if (!Array.isArray(result?.events) || result.events.length > 200 || (result.nextPageCursor != null && typeof result.nextPageCursor !== 'string')) {
      throw new Error('The booking server returned an invalid page.');
    }
    if (params.allTime && result.scope !== 'all-time') {
      const error = new Error('The server does not yet support the complete all-time bookings list. Please contact an administrator.');
      error.code = 'bookings-incompatible';
      throw error;
    }
    if (params.allTime && result.events.some(event =>
      !event || typeof event.id !== 'string' || typeof event.startAt !== 'string' || typeof event.endAt !== 'string' ||
      !Number.isFinite(Date.parse(event.startAt)) || !Number.isFinite(Date.parse(event.endAt)))) {
      const error = new Error('A booking has an invalid date and the complete list cannot be displayed. Please contact an administrator.');
      error.code = 'bookings-invalid';
      throw error;
    }
    events.push(...result.events);
    cursor = result.nextPageCursor || null;
    if (!cursor) return events;
    if (seen.has(cursor)) throw new Error('The booking server repeated a page cursor.');
    seen.add(cursor);
  }
  const error = new Error('More than 10,000 bookings cannot be loaded safely. Please contact an administrator.');
  error.code = 'bookings-too-many';
  throw error;
}
