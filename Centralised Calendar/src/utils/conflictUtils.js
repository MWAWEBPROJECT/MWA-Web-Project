import {venueConflictReason} from './venuePolicy.js';
// Client-side twin of functions/conflictUtils.js (same rule): each active booking occupies
// [start, end + its venue's buffer]; a pair conflicts if either occupancy overlaps the other's booked time.
// Whole-site venues (e.g. "Entire MWA Precinct") conflict with every venue.
// Used so admins see conflicts computed live from current data, not only stored flags.

export function resolveBufferHours(v) {
  if (!v) return 0;
  if (v.bufferHours !== undefined && v.bufferHours !== null) { const n = Number(v.bufferHours); return Number.isFinite(n) ? n : 0; }
  if (v.bufferMinutes !== undefined && v.bufferMinutes !== null) { const n = Number(v.bufferMinutes); return Number.isFinite(n) ? n / 60 : 0; }
  return 0;
}

export function isWholeSiteVenue(v) {
  if (!v) return false;
  if (v.coversAllVenues === true) return true;
  if (v.coversAllVenues === false) return false;
  return /\b(entire|whole)\b/i.test(String(v.name || ''));
}

const ms = (iso) => new Date(iso).getTime();
const overlapBuf = (a, b, buf) => ms(a.startAt) < ms(b.endAt) + buf * 3600000 && ms(a.endAt) > ms(b.startAt);

export function pairConflicts(a, b) {
  return overlapBuf(a, b, b._buf || 0) || overlapBuf(b, a, a._buf || 0);
}

/** Map<eventId, conflictingEventIds[]> for all active events. */
export function computeAllConflicts(events, venues) {
  const vById = new Map(venues.map(v => [v.id, v]));
  const active = events
    .filter(e => e.venueId && e.startAt && e.endAt && Number.isFinite(ms(e.startAt)) && Number.isFinite(ms(e.endAt)) && (e.status === 'pending' || e.status === 'confirmed'))
    .map(e => ({ ...e, _buf: resolveBufferHours(vById.get(e.venueId)), _whole: isWholeSiteVenue(vById.get(e.venueId)) }))
    .sort((x, y) => ms(x.startAt) - ms(y.startAt));
  const out = new Map(active.map(e => [e.id, []]));
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i]; const b = active[j];
      if (ms(b.startAt) >= ms(a.endAt) + Math.max(0, a._buf) * 3600000) break;
      if (venueConflictReason(a,b,vById.get(a.venueId),vById.get(b.venueId)) && pairConflicts(a, b)) {
        out.get(a.id).push(b.id); out.get(b.id).push(a.id);
      }
    }
  }
  return out;
}

/** Admin-only: overlay live-computed hasConflict on events (non-admin events are masked and keep their flags). */
export function withLiveConflicts(events, venues, isAdmin) {
  if (!isAdmin) return events;
  const map = computeAllConflicts(events, venues);
  return events.map(e => (e.status === 'pending' || e.status === 'confirmed') ? { ...e, hasConflict: (map.get(e.id) || []).length > 0 } : { ...e, hasConflict: false });
}
