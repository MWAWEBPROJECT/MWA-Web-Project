// Pure helpers for venue overlap/buffer logic, kept dependency-free (no
// firebase-admin) so they can be unit-tested in isolation — see conflictUtils.test.js.

/**
 * Safe read-time fallback for the bufferMinutes -> bufferHours rename: prefer
 * bufferHours, else convert a legacy bufferMinutes value, else 0. No destructive
 * Firestore migration is required — every read resolves consistently.
 */
function resolveBufferHours(venueData) {
  if (!venueData) return 0;
  if (venueData.bufferHours !== undefined && venueData.bufferHours !== null) {
    const n = Number(venueData.bufferHours);
    return Number.isFinite(n) ? n : 0;
  }
  if (venueData.bufferMinutes !== undefined && venueData.bufferMinutes !== null) {
    const n = Number(venueData.bufferMinutes);
    return Number.isFinite(n) ? n / 60 : 0;
  }
  return 0;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Post-booking buffer: an *existing* active booking occupies
 * [otherStart, otherEnd + bufferHours] for conflict purposes. The buffer is only
 * applied after the existing booking's end (never before its start), and only to
 * that existing booking — never to the incoming candidate range — so a buffer can
 * never block a new submission, only flag hasConflict/conflictWith.
 */
function rangesOverlapBuffered(candidateStart, candidateEnd, otherStart, otherEnd, bufferHours) {
  const bufferMs = (Number(bufferHours) || 0) * 60 * 60 * 1000;
  const bufferedOtherEnd = new Date(otherEnd).getTime() + bufferMs;
  return new Date(candidateStart).getTime() < bufferedOtherEnd && new Date(candidateEnd).getTime() > new Date(otherStart).getTime();
}

/**
 * Symmetric conflict between two bookings at the same venue: each booking occupies
 * [start, end + buffer], so the pair conflicts if either one's occupancy overlaps the
 * other's booked time. This is the same "existing booking occupies [start, end+buffer]"
 * rule applied in both directions, so the result never depends on which was created first.
 */
function rangesConflict(a, b, bufferHours) {
  // Each booking may carry its own venue buffer (_buf) — needed when a whole-site venue
  // is compared against a booking at a single hall.
  const ba = a._buf !== undefined ? a._buf : bufferHours;
  const bb = b._buf !== undefined ? b._buf : bufferHours;
  return rangesOverlapBuffered(a.startAt, a.endAt, b.startAt, b.endAt, bb)
    || rangesOverlapBuffered(b.startAt, b.endAt, a.startAt, a.endAt, ba);
}

/** A venue that occupies the whole site (e.g. "Entire MWA Precinct") conflicts with every other
 * venue. Set venues/{id}.coversAllVenues = true; as a fallback a name containing "entire"/"whole" counts. */
function isWholeSiteVenue(venue) {
  if (!venue) return false;
  if (venue.coversAllVenues === true) return true;
  if (venue.coversAllVenues === false) return false;
  return /\b(entire|whole)\b/i.test(String(venue.name || ''));
}

/**
 * Pure conflict map for a venue's active (pending/confirmed) bookings:
 * Map<id, string[]> of the other bookings each one conflicts with.
 */
function computeConflictMap(events, bufferHours) {
  const sorted = [...events].sort((x, y) => String(x.startAt).localeCompare(String(y.startAt)));
  const map = new Map(sorted.map(e => [e.id, []]));
  let maxReach = -Infinity;
  for (let i = 0; i < sorted.length; i += 1) {
    const b = sorted[i];
    const bStart = new Date(b.startAt).getTime();
    // Nothing earlier in start order can reach this booking: skip the scan entirely.
    const reach = (e) => new Date(e.endAt).getTime() + (Number(e._buf !== undefined ? e._buf : bufferHours) || 0) * 3600000;
    if (bStart >= maxReach) { maxReach = Math.max(maxReach, reach(b)); continue; }
    for (let j = 0; j < i; j += 1) {
      const a = sorted[j];
      if (rangesConflict(a, b, bufferHours)) {
        map.get(a.id).push(b.id);
        map.get(b.id).push(a.id);
      }
    }
    maxReach = Math.max(maxReach, reach(b));
  }
  return map;
}

/**
 * Conflict map for ALL bookings: same-venue overlaps plus whole-site venue overlaps, each booking
 * using its own venue's buffer. Returns Map<id, string[]> over active (pending/confirmed) bookings.
 */
function computeAllConflicts(events, venues) {
 const vById=new Map(venues.map(v=>[v.id,v]));
 const active=events.filter(e=>e.venueId&&e.startAt&&e.endAt&&['pending','confirmed'].includes(e.status)).map(e=>({...e,_buf:resolveBufferHours(vById.get(e.venueId))})).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
 const out=new Map(active.map(e=>[e.id,[]]));
 for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
  const a=active[i],b=active[j];
  if(Date.parse(b.startAt)>=Date.parse(a.endAt)+Math.max(0,a._buf)*3600000)break;
  if(require('./venuePolicy').venueConflictReason(a,b,vById.get(a.venueId),vById.get(b.venueId))&&rangesConflict(a,b,0)){out.get(a.id).push(b.id);out.get(b.id).push(a.id);}
 }
 return out;
}

module.exports = { isWholeSiteVenue, computeAllConflicts, resolveBufferHours, rangesOverlap, rangesOverlapBuffered, rangesConflict, computeConflictMap };
