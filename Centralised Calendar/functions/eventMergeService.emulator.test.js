const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Merge = require('./eventMergeService');

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const actor = { uid: 'synthetic-merge-admin', email: 'admin@muhammadiwelfare.org.au', modules: ['events-bookings', 'niaz', 'niaz-finance', 'donations', 'form-builder'] };
const dateKey = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

test('atomic merge moves selected operational links and retains financial and response history', { skip: !process.env.FIRESTORE_EMULATOR_HOST, timeout: 120000 }, async () => {
  const app = initializeApp({ projectId: 'demo-mwa-merge' }, `merge-${randomUUID()}`), db = getFirestore(app), prefix = randomUUID();
  const keepId = `${prefix}-keep`, removeId = `${prefix}-remove`, startAt = '2027-06-14T08:00:00.000Z', endAt = '2027-06-14T10:00:00.000Z';
  const keep = { title: 'First occasion', status: 'confirmed', visibility: 'public', departmentName: 'MWA Programs', venueId: 'main', startAt, endAt, audience: 'family', volunteers: [{ id: 'v1', name: 'A' }] };
  const remove = { ...keep, title: 'Second occasion', status: 'pending', volunteers: [{ id: 'v2', name: 'B' }] };
  const sponsorId = `${prefix}-sponsor`, assignmentId = Merge.mergeKey(sponsorId, removeId, 'coordinator'), donationId = `${prefix}-donation`, discardedId = `${prefix}-discarded`, otherSponsorId = `${prefix}-other`, formId = `${prefix}-form`, responseId = `${prefix}-response`;
  try {
    const batch = db.batch();
    batch.set(db.doc(`events/${keepId}`), keep); batch.set(db.doc(`events/${removeId}`), remove);
    batch.set(db.doc(`niazSponsors/${sponsorId}`), { name: 'Synthetic sponsor', active: true, publicConsent: true });
    batch.set(db.doc(`niazSponsorships/${assignmentId}`), { sponsorId, eventId: removeId, origin: 'coordinator', status: 'approved', role: 'sole', revision: 1 });
    batch.set(db.doc(`niazEOIs/${prefix}`), { eventIds: [removeId], events: [{ eventId: removeId, status: 'approved' }], status: 'approved', revision: 1 });
    batch.set(db.doc(`_stripeSandboxDonations/${donationId}`), { name: 'Synthetic donor', email: 'synthetic@example.invalid', amount: 2000, status: 'paid', fulfillmentPending: false, niaz: { scope: 'event', eventId: removeId, date: '2027-06-14', title: 'Second occasion' } });
    batch.set(db.doc(`_stripeSandboxDonations/${discardedId}`), { name: 'Other donor', email: 'other@example.invalid', amount: 500, status: 'paid', fulfillmentPending: false, niaz: { scope: 'event', eventId: removeId, date: '2027-06-14', title: 'Second occasion' } });
    batch.set(db.doc(`_niazSandboxLedger/${prefix}`), { eventId: removeId, sponsorId, entry: { transactionId: donationId, eventId: removeId, netCents: 2000 } });
    batch.set(db.doc(`_niazSandboxLedger/${prefix}-other`), { eventId: removeId, sponsorId: otherSponsorId, entry: { transactionId: discardedId, eventId: removeId, netCents: 500 } });
    batch.set(db.doc(`_niazSandboxAssociations/${Merge.associationKey(sponsorId, removeId)}`), { eventId: removeId, sponsorId, netCents: 2000 });
    batch.set(db.doc(`_niazSandboxAssociations/${Merge.associationKey(otherSponsorId, removeId)}`), { eventId: removeId, sponsorId: otherSponsorId, netCents: 500 });
    batch.set(db.doc(`registrationForms/${formId}`), { eventId: removeId, revision: 1, title: 'Registration' });
    batch.set(db.doc(`registrationForms/${formId}/responses/${responseId}`), { eventId: removeId, answers: { name: 'Synthetic respondent' } });
    batch.set(db.doc(`_registrationInsights/${prefix}`), { eventId: removeId, formId, responseId });
    batch.set(db.doc('_responseViewers/synthetic@example.invalid'), { eventId: removeId, formIds: [formId], revision: 1 });
    batch.set(db.doc(`niazEventCoverage/${removeId}`), { targetCents: 2000, arrangementConfirmed: true, revision: 1 });
    await batch.commit();
    const review = await Merge.preview(db, actor, keepId, removeId, HttpsError);
    assert.equal(review.counts.responses, 1);
    await assert.rejects(Merge.preview(db, { ...actor, modules: ['events-bookings'] }, keepId, removeId, HttpsError), { code: 'permission-denied' });
    assert.equal(review.sponsorships[0].name, 'Synthetic sponsor');
    const input = { keepId, removeId, version: review.version, title: 'Combined programme', extras: { volunteers: ['keep:v1', 'remove:v2'], reciters: [], expenses: [] }, sponsorIds: [assignmentId], donationIds: [donationId], coverageSource: 'remove', fields: { startAt, endAt, audience: 'family' }, confirmDelete: true };
    await assert.rejects(Merge.execute(db, actor, { ...input, version: 'stale' }, HttpsError, { findOverlaps: async () => [], refreshConflicts: async () => {}, dateKey }), { code: 'failed-precondition' });
    await assert.rejects(Merge.execute(db, actor, input, HttpsError, { findOverlaps: async () => [{ id: 'third-party' }], refreshConflicts: async () => {}, dateKey }), { code: 'failed-precondition' });
    const result = await Merge.execute(db, actor, input, HttpsError, { findOverlaps: async () => [{ id: removeId }], refreshConflicts: async () => {}, dateKey });
    assert.equal(result.keptId, keepId);
    assert.equal((await db.doc(`events/${removeId}`).get()).exists, false);
    const saved = (await db.doc(`events/${keepId}`).get()).data();
    assert.equal(saved.title, 'Combined programme'); assert.equal(saved.status, 'confirmed'); assert.equal(saved.volunteers.length, 2);
    assert.equal((await db.doc(`_stripeSandboxDonations/${donationId}`).get()).data().niaz.eventId, keepId);
    assert.equal((await db.doc(`_niazSandboxLedger/${prefix}`).get()).data().eventId, keepId);
    assert.equal((await db.doc(`_stripeSandboxDonations/${discardedId}`).get()).data().niaz.scope, 'historical_event');
    assert.equal((await db.doc(`_niazSandboxLedger/${prefix}-other`).get()).exists, false);
    assert.equal((await db.doc(`_niazSandboxAssociations/${Merge.associationKey(otherSponsorId, removeId)}`).get()).exists, false);
    assert.equal((await db.doc(`registrationForms/${formId}/responses/${responseId}`).get()).data().eventId, keepId);
    assert.equal((await db.doc(`_registrationInsights/${prefix}`).get()).data().eventId, keepId);
    assert.equal((await db.doc(`_responseViewers/synthetic@example.invalid`).get()).data().eventId, keepId);
    assert.equal((await db.doc(`niazEOIs/${prefix}`).get()).data().eventIds[0], keepId);
    assert.equal((await db.doc(`niazSponsorships/${assignmentId}`).get()).exists, false);
    assert.equal((await db.doc(`niazSponsorships/${Merge.mergeKey(sponsorId, keepId, 'coordinator')}`).get()).exists, true);
    assert.equal((await db.doc(`_eventMerges/${removeId}`).get()).data().keptId, keepId);
  } finally { await db.terminate(); await deleteApp(app); }
});
