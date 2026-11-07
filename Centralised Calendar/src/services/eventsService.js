// Events/bookings service.
//
// Public visitors and admins read event data through server-side Functions so
// query bounds, authorization, conflict checks, and visibility are enforced centrally.
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/firebase';
import { collectAdminEventPages } from './adminEventPages.mjs';

/**
 * Public submission. Always lands as status "pending" — the server decides
 * conflict flags; a conflict NEVER blocks the request, it only flags it for
 * the admin to review (see the brief's conflict-handling requirement).
 */
export async function submitBooking(payload) {
  const fn = httpsCallable(functions, 'submitBooking');
  const res = await fn(payload);
  return res.data;
}

export async function startBookingVerification(payload) {
  const res = await httpsCallable(functions, 'startBookingVerification')(payload);
  return res.data;
}

export async function verifyBookingEmailCode(payload) {
  const res = await httpsCallable(functions, 'verifyBookingEmailCode')(payload);
  return res.data;
}

export async function verifyBookingMobile(payload) {
  const res = await httpsCallable(functions, 'verifyBookingMobile')(payload);
  return res.data;
}

/** Admin decision: confirm / reject / cancel, with optional visibility + note. */
export async function decideBooking({ eventId, status, visibility, note }) {
  const fn = httpsCallable(functions, 'decideBooking');
  const res = await fn({ eventId, status, visibility, note });
  return res.data;
}

/** Admin edit of an existing booking's core fields (re-runs conflict check). */
export async function updateBooking(eventId, patch) {
  const fn = httpsCallable(functions, 'updateBooking');
  const res = await fn({ eventId, patch });
  return res.data;
}

/** Public, read-only, sanitized events for the public calendar (no auth). */
export async function fetchPublicEvents({ from, to } = {}) {
  const fn = httpsCallable(functions, 'getPublicEvents');
  const events = [];
  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const res = await fn({ from, to, cursor });
    events.push(...(res.data?.events || []));
    cursor = res.data?.nextPageCursor || null;
    if (!cursor) return events;
  }
  throw new Error('There are too many calendar events in this date range to load safely. Narrow the date range and try again.');
}

/** Admin-only event history for a bounded calendar range, loaded in stable cursor pages. */
export async function fetchAdminEvents({ from, to }) {
  const fn = httpsCallable(functions, 'getAdminEvents');
  return collectAdminEventPages(async payload => (await fn(payload)).data, { from, to });
}

/** Admin-only bookings from all years, bounded and never returned partially. */
export async function fetchAllAdminBookings({ signal } = {}) {
  const fn = httpsCallable(functions, 'getAdminEvents');
  return collectAdminEventPages(async payload => (await fn(payload)).data, { allTime: true }, { signal });
}

/** Admin edit; `scope` ('single' | 'future' | 'all') applies shared fields/time-of-day across a recurring series. */
export async function updateBookingScoped(eventId, patch, scope = 'single') {
  const fn = httpsCallable(functions, 'updateBooking');
  const res = await fn({ eventId, patch, scope });
  return res.data;
}

/** Admin-only: create a recurring series (expanded + conflict-flagged server-side). */
export async function createRecurringBooking(payload) {
  const fn = httpsCallable(functions, 'createRecurringBooking');
  const res = await fn(payload);
  return res.data;
}

/** Admin-only: delete one occurrence, this & future, or the whole series. */
export async function deleteBooking(eventId, scope = 'single') {
  const fn = httpsCallable(functions, 'deleteBooking');
  const res = await fn({ eventId, scope });
  return res.data;
}

async function call(name, data) {
  const res = await httpsCallable(functions, name)(data);
  return res.data;
}

/** Live conflict check. Public callers get { hasConflict, count } only; admins also get the list. */
export const checkSlotConflicts = (payload) => call('checkSlotConflicts', payload);

/** Admin-only: exact occurrence list + per-occurrence conflicts, before creating a series. */
export const previewRecurringBooking = (payload) => call('previewRecurringBooking', payload);

/** Admin-only: Excel import (`dryRun: true` validates only). */
export const importBookings = (rows, dryRun) => call('importBookings', { rows, dryRun });

/** Admin-only: recompute every stored overlap flag (buffer-aware, symmetric). */
export const recomputeAllConflicts = () => call('recomputeAllConflicts', {});

/** Admin-only: Niaz sponsor / reciters / volunteers / expenses for one MWA Programs booking (partial patch). */
export const updateProgramExtras = (eventId, patch) => call('updateProgramExtras', { eventId, ...patch });
