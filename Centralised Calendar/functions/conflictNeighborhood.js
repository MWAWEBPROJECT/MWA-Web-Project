function createConflictNeighborhoodRefresher({
  db, HttpsError, activeStatuses, maxCandidates, maxVenues, findOverlaps,
  resolveBufferHours, rangesConflict
}) {
  return async function refreshConflictNeighborhood(changes) {
    const changed = (changes || []).filter(change => change && change.id && (change.before || change.after));
    if (!changed.length) return 0;
    if (changed.length > maxCandidates) {
      throw new HttpsError('resource-exhausted', 'Too many changed bookings to refresh conflicts safely in one request.');
    }
    const venueSnapshot = await db.collection('venues').limit(maxVenues + 1).get();
    const venues = venueSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (venues.length > maxVenues) {
      throw new HttpsError('resource-exhausted', 'There are too many configured venues to refresh conflicts safely.');
    }
    const venueById = new Map(venues.map(venue => [venue.id, venue]));
    const changedIds = new Set(changed.map(change => change.id));
    const neighbors = new Set();
    const nextConflicts = new Map();
    const active = event => event && activeStatuses.includes(event.status);

    for (const change of changed) {
      const previousLinks = [
        ...(Array.isArray(change.before?.conflictWith) ? change.before.conflictWith : []),
        ...(Array.isArray(change.after?.conflictWith) ? change.after.conflictWith : [])
      ];
      if (previousLinks.length > maxCandidates) {
        throw new HttpsError('resource-exhausted', 'Too many linked bookings to refresh conflicts safely.');
      }
      previousLinks.forEach(id => { if (!changedIds.has(id)) neighbors.add(id); });
      for (const event of [change.before, change.after]) {
        if (!active(event)) continue;
        const overlap = await findOverlaps(
          event.venueId, event.startAt, event.endAt, change.id, undefined,
          resolveBufferHours(venueById.get(event.venueId)), venues
        );
        overlap.forEach(item => neighbors.add(item.id));
        if (event === change.after) nextConflicts.set(change.id, overlap.map(item => item.id).sort());
      }
    }
    if (neighbors.size + changed.length > 450) {
      throw new HttpsError('resource-exhausted', 'Too many bookings are affected by this change to refresh conflicts safely.');
    }

    const neighborDocs = neighbors.size
      ? await db.getAll(...[...neighbors].map(id => db.collection('events').doc(id)))
      : [];
    const neighborById = new Map(neighborDocs.filter(doc => doc.exists).map(doc => [doc.id, doc.data()]));
    const batch = db.batch();
    let writes = 0;
    for (const change of changed) {
      if (!active(change.after)) continue;
      const links = nextConflicts.get(change.id) || [];
      batch.update(db.collection('events').doc(change.id), {
        conflictWith: links,
        hasConflict: links.length > 0
      });
      writes += 1;
    }
    for (const [id, event] of neighborById) {
      if (!activeStatuses.includes(event.status)) continue;
      const links = new Set(Array.isArray(event.conflictWith) ? event.conflictWith : []);
      changedIds.forEach(changedId => links.delete(changedId));
      for (const change of changed) {
        if (!active(change.after)) continue;
        const left = change.after, right = { id, ...event };
        if (!venueById.has(left.venueId) || !venueById.has(right.venueId)) continue;
        if (rangesConflict(
          { startAt: left.startAt, endAt: left.endAt, _buf: resolveBufferHours(venueById.get(left.venueId)) },
          { startAt: right.startAt, endAt: right.endAt, _buf: resolveBufferHours(venueById.get(right.venueId)) },
          0
        )) links.add(change.id);
      }
      const conflictWith = [...links].sort();
      const old = [...new Set(Array.isArray(event.conflictWith) ? event.conflictWith : [])].sort();
      if (conflictWith.join(',') !== old.join(',') || Boolean(event.hasConflict) !== (conflictWith.length > 0)) {
        batch.update(db.collection('events').doc(id), {
          conflictWith,
          hasConflict: conflictWith.length > 0
        });
        writes += 1;
      }
    }
    if (writes) await batch.commit();
    return writes;
  };
}

module.exports = { createConflictNeighborhoodRefresher };
