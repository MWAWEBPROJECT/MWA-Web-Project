const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const bookingVerification = require('./bookingVerification');
const { createBookingSubmissionService } = require('./bookingSubmission');

const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = 'demo-mwa-booking-submission';
const sessionId = 'booking-session-0123456789';
const sessionIdHash = crypto.createHash('sha256').update(sessionId).digest('hex');
const HttpsError = class extends Error {
  constructor(code, message) { super(message); this.code = code; }
};

function payload(method = 'email') {
  return bookingVerification.canonicalBookingPayload({
    title: 'Emulator booking',
    departmentId: 'events',
    venueId: 'hall',
    startAt: '2027-01-15T01:00:00.000Z',
    endAt: '2027-01-15T03:00:00.000Z',
    contactName: 'Test requester',
    contactEmail: method === 'mobile' ? '' : 'requester@example.org',
    contactPhone: method === 'mobile' ? '+61412345678' : '',
    notes: 'Integration test'
  });
}

async function clearProject(project) {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!response.ok) throw new Error(`Could not clear Firestore emulator documents: ${response.status}`);
}

test('Firestore emulator: email/mobile booking proof is atomic, single-use and idempotent', { skip: !emulatorEnabled }, async t => {
  const app = initializeApp({ projectId }, `booking-submission-${crypto.randomUUID()}`);
  const db = getFirestore(app);
  try {
    for (const method of ['email', 'mobile']) {
      await clearProject(projectId);
      assert.equal((await db.collection('events').get()).size, 0, 'each method starts with an empty emulator database');
      const booking = payload(method);
      const challengeId = bookingVerification.newChallengeId();
      const contact = bookingVerification.selectedContact(method, booking);
      const proofPayload = method === 'mobile' ? { ...booking, contactPhone: contact } : booking;
      const challengeRef = db.collection('_bookingVerificationChallenges').doc(challengeId);
      let sendCalls = 0, linkCalls = 0, refreshed = 0;
      const service = createBookingSubmissionService({
        db, FieldValue, Timestamp, HttpsError, bookingVerification,
        prepareBookingPayload: async value => ({
          prepared: bookingVerification.canonicalBookingPayload(value),
          venue: { id: 'hall', name: 'Main Hall', bufferHours: 0 },
          department: { id: 'events', name: 'Events Booking' },
          overrides: []
        }),
        findOverlaps: async (_venueId, _start, _end, _exclude, tx) => {
          assert.ok(tx, 'overlap reads must be inside the submission transaction');
          return [];
        },
        resolveBufferHours: () => 0,
        refreshConflictNeighborhood: async () => { refreshed += 1; },
        sessionHash: value => { assert.equal(value, sessionId); return sessionIdHash; },
        sanitizeVisibility: value => value === 'private' ? 'private' : value === 'public' ? 'public' : null,
        auditEntry: value => value,
        issueLink: async (_db, id) => {
          assert.ok((await db.collection('events').doc(id).get()).exists, `approval link must follow booking commit for ${id}`);
          linkCalls += 1;
          return { approve: 'test', reject: 'test' };
        },
        sendAll: async messages => {
          assert.ok((await db.collection('events').get()).size > 0, 'notifications must follow booking commit');
          sendCalls += 1;
          return messages.map(() => ({ sent: true }));
        },
        notify: {
          submissionRequester: () => ({ type: 'requester' }),
          submissionAdmin: () => ({ type: 'admin' })
        },
        hijriInfoFor: () => null,
        dateKeyOf: () => '2027-01-15',
        logger: { error: error => { throw error; } }
      });
      await challengeRef.set({
        purpose: 'public-booking', method, contact,
        payloadDigest: bookingVerification.payloadDigest(proofPayload),
        sessionIdHash, status: 'verified', verifiedAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
      });

      const request = { ...booking, verificationChallengeId: challengeId, verificationSessionId: sessionId };
      const results = await Promise.all([service(request, { isAdmin: false }), service(request, { isAdmin: false })]);
      assert.equal(results[0].id, results[1].id, `concurrent ${method} submissions must replay one event`);
      assert.equal((await db.collection('events').get()).size, 1, `concurrent ${method} submissions must create one event`);
      assert.equal((await db.collection('auditLog').get()).size, 1);
      assert.equal((await challengeRef.get()).data().status, 'consumed');
      assert.equal(sendCalls, 1);
      assert.equal(linkCalls, 1);
      assert.equal(refreshed, 1);

      const saved = (await db.collection('events').doc(results[0].id).get()).data();
      assert.equal(saved.status, 'pending');
      assert.equal(saved.contactVerification.method, method);
      assert.equal(saved.contactEmailVerified, method === 'email');
      assert.equal(saved.contactPhoneVerified, method === 'mobile');
      assert.equal(saved.contactVerification.contact, contact);
      if (method === 'mobile') assert.equal(saved.contactEmail, '', 'mobile verification must not require an email address');
    }
  } finally {
    await deleteApp(app);
  }
});

test('Firestore emulator: unverified or rebound proof creates no booking, audit or notification', { skip: !emulatorEnabled }, async t => {
  const app = initializeApp({ projectId }, `booking-rejected-${crypto.randomUUID()}`);
  const db = getFirestore(app);
  const booking = payload();
  const challengeId = bookingVerification.newChallengeId();
  const challengeRef = db.collection('_bookingVerificationChallenges').doc(challengeId);
  let sends = 0;
  const service = createBookingSubmissionService({
    db,
    FieldValue,
    Timestamp,
    HttpsError,
    bookingVerification,
    prepareBookingPayload: async value => ({
      prepared: bookingVerification.canonicalBookingPayload(value),
      venue: { id: 'hall', name: 'Main Hall', bufferHours: 0 },
      department: { id: 'events', name: 'Events Booking' },
      overrides: []
    }),
    findOverlaps: async () => [],
    resolveBufferHours: () => 0,
    refreshConflictNeighborhood: async () => {},
    sessionHash: () => sessionIdHash,
    sanitizeVisibility: value => value,
    auditEntry: value => value,
    issueLink: async () => { throw new Error('an invalid attempt must not issue an approval link'); },
    sendAll: async () => { sends += 1; },
    notify: {},
    hijriInfoFor: () => null,
    dateKeyOf: () => '',
    logger: { error: () => {} }
  });

  try {
    await clearProject(projectId);
    await challengeRef.set({
      purpose: 'public-booking',
      method: 'email',
      contact: booking.contactEmail,
      payloadDigest: bookingVerification.payloadDigest(booking),
      sessionIdHash,
      status: 'active',
      verifiedAt: null,
      expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
    });
    const request = { ...booking, verificationChallengeId: challengeId, verificationSessionId: sessionId };
    await assert.rejects(service(request, { isAdmin: false }), { code: 'failed-precondition' });
    await assert.rejects(service({ ...request, title: 'Changed after proof' }, { isAdmin: false }), { code: 'failed-precondition' });
    assert.equal((await db.collection('events').get()).size, 0);
    assert.equal((await db.collection('auditLog').get()).size, 0);
    assert.equal(sends, 0);
    assert.notEqual((await challengeRef.get()).data().status, 'consumed');
  } finally {
    await deleteApp(app);
  }
});
