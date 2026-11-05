const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createConflictNeighborhoodRefresher } = require('./conflictNeighborhood');
const { rangesConflict, resolveBufferHours, isWholeSiteVenue } = require('./conflictUtils');

const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = 'demo-mwa-conflict-neighborhood';
const HttpsError = class extends Error {
  constructor(code, message) { super(message); this.code = code; }
};

test('Firestore emulator: conflict refresh repairs old/new reciprocal links across venues and day boundaries', {
  skip: !emulatorEnabled
}, async () => {
  const app = initializeApp({ projectId }, `conflict-neighborhood-${crypto.randomUUID()}`);
  const db = getFirestore(app);
  const venues = [
    { id: 'hall', name: 'Main Hall', bufferHours: 1 },
    { id: 'precinct', name: 'Whole Site', coversAllVenues: true, bufferHours: 0 }
  ];
  const venueById = new Map(venues.map(venue => [venue.id, venue]));
  const activeStatuses = ['pending', 'confirmed'];
  const calls = [];
  const findOverlaps = async (venueId, startAt, endAt, excludeId, _tx, _buffer, cachedVenues) => {
    calls.push({ venueId, startAt, endAt });
    const candidateVenue = venueById.get(venueId);
    const scopedIds = isWholeSiteVenue(candidateVenue)
      ? new Set(cachedVenues.map(venue => venue.id))
      : new Set([venueId, ...cachedVenues.filter(isWholeSiteVenue).map(venue => venue.id)]);
    const snapshot = await db.collection('events').get();
    return snapshot.docs
      .filter(doc => doc.id !== excludeId && activeStatuses.includes(doc.data().status) && scopedIds.has(doc.data().venueId))
      .filter(doc => rangesConflict(
        { startAt, endAt, _buf: resolveBufferHours(candidateVenue) },
        { ...doc.data(), _buf: resolveBufferHours(venueById.get(doc.data().venueId)) },
        0
      ))
      .map(doc => ({ id: doc.id }));
  };
  const refresh = createConflictNeighborhoodRefresher({
    db,
    HttpsError,
    activeStatuses,
    maxCandidates: 500,
    maxVenues: 100,
    findOverlaps,
    resolveBufferHours,
    rangesConflict
  });

  try {
    await db.collection('venues').doc('hall').set(venues[0]);
    await db.collection('venues').doc('precinct').set(venues[1]);
    const events = db.collection('events');
    const before = {
      venueId: 'hall', startAt: '2027-01-01T22:00:00.000Z', endAt: '2027-01-01T23:00:00.000Z',
      status: 'confirmed', conflictWith: ['former'], hasConflict: true
    };
    const after = {
      venueId: 'hall', startAt: '2027-01-02T23:00:00.000Z', endAt: '2027-01-03T03:00:00.000Z',
      status: 'confirmed', conflictWith: [], hasConflict: false
    };
    await events.doc('moving').set(after);
    await events.doc('former').set({
      venueId: 'hall', startAt: '2027-01-01T23:30:00.000Z', endAt: '2027-01-02T00:00:00.000Z',
      status: 'pending', conflictWith: ['moving'], hasConflict: true
    });
    await events.doc('whole-site').set({
      venueId: 'precinct', startAt: '2027-01-03T02:00:00.000Z', endAt: '2027-01-03T02:30:00.000Z',
      status: 'pending', conflictWith: [], hasConflict: false
    });
    await events.doc('buffer-next-day').set({
      venueId: 'hall', startAt: '2027-01-03T03:30:00.000Z', endAt: '2027-01-03T04:30:00.000Z',
      status: 'confirmed', conflictWith: [], hasConflict: false
    });
    await events.doc('unrelated').set({
      venueId: 'hall', startAt: '2027-02-01T00:00:00.000Z', endAt: '2027-02-01T01:00:00.000Z',
      status: 'confirmed', conflictWith: ['other'], hasConflict: true
    });

    await refresh([{ id: 'moving', before, after }]);
    const moved = (await events.doc('moving').get()).data();
    const former = (await events.doc('former').get()).data();
    const wholeSite = (await events.doc('whole-site').get()).data();
    const bufferNextDay = (await events.doc('buffer-next-day').get()).data();
    const unrelated = (await events.doc('unrelated').get()).data();
    assert.deepEqual(moved.conflictWith, ['buffer-next-day', 'whole-site']);
    assert.deepEqual(former.conflictWith, []);
    assert.deepEqual(wholeSite.conflictWith, ['moving']);
    assert.deepEqual(bufferNextDay.conflictWith, ['moving']);
    assert.deepEqual(unrelated.conflictWith, ['other']);
    assert.equal(calls.length, 2, 'only the old and new booking neighborhoods are queried');

    await events.doc('moving').delete();
    await refresh([{ id: 'moving', before: moved }]);
    assert.deepEqual((await events.doc('whole-site').get()).data().conflictWith, []);
    assert.deepEqual((await events.doc('buffer-next-day').get()).data().conflictWith, []);
  } finally {
    await deleteApp(app);
  }
});
