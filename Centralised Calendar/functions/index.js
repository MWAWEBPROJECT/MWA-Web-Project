const {resolveAdmin}=require('./moduleAccess');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getAppCheck } = require('firebase-admin/app-check');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const express = require('express');
const cors = require('cors');
const { jsonBody } = require('./apiBody');
const { commitInChunks: commitBatches } = require('./batchWrites');

const { adjustedGregorianToIslamic, HIJRI_MONTHS } = require('./hijriService');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { sendAll, sendMail, emailSecrets } = require('./mailer');
const notify = require('./notifications');
const { resolveBufferHours, rangesConflict, computeAllConflicts, isWholeSiteVenue } = require('./conflictUtils');
const { validateImportRows, importIds, MAX_IMPORT_ROWS, completeImport } = require('./bookingImport');
const { MIN_PUBLIC_LEAD_HOURS, validateBookingLeadTime } = require('./publicLeadTime');
const { canSubmitBookingType } = require('./bookingTypePolicy');
const { buildConflictResponse } = require('./conflictResponse');
const { resolveBookingDates } = require('./hijriRecompute');
const { projectPublicEvent } = require('./publicProjection');
const { generateOccurrences, RecurrenceError } = require('./recurrence');
const { normalizeScope, selectSeriesTargets, retimeOccurrence } = require('./seriesScope');
const { toOrgTimeParts } = require('./dateUtils');
const { sanitizePrayer, resolvePrayerInstants } = require('./prayerTimes');
const { sanitizeProgramExtras, expensesTotal } = require('./programExtras');
const { OWNER_EMAIL, normalizeEmail, isValidEmail, decideSignIn, checkRemoval, checkAddition, sessionAllowed, shouldDisablePasswordLogin } = require('./adminAccess');
const bookingVerification = require('./bookingVerification');
const { createBookingSubmissionService } = require('./bookingSubmission');
const { createConflictNeighborhoodRefresher, conflictScopeQuery } = require('./conflictNeighborhood');
const publicQuery = require('./publicQuery');

initializeApp();
const db = getFirestore();
const BOOKING_OTP_HMAC_KEY = defineSecret('BOOKING_OTP_HMAC_KEY');

const REGION = 'australia-southeast1';
setGlobalOptions({ region: REGION });

const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];
const ACTIVE_FOR_CONFLICTS = ['pending', 'confirmed'];
const MAX_CONFLICT_CANDIDATES = 500;
const MAX_VENUES_FOR_CONFLICTS = 100;
const CONFLICT_REFRESH_BATCH_SIZE = 50;
const MAX_SERIES_OCCURRENCES = 500;
const MAX_BOOKING_DURATION_MS = publicQuery.MAX_RANGE_DAYS * publicQuery.DAY_MS;
const MAX_IMPORT_DUPLICATE_CANDIDATES = 500;

function boundedEventQuery(query, range, cursor) {
  let page = query
    .where('startAt', '<', range.to)
    .where('endAt', '>', range.from)
    .orderBy('startAt').orderBy('endAt')
    .orderBy(FieldPath.documentId());
  if (cursor) page = page.startAfter(cursor.startAt, cursor.endAt, cursor.id);
  return page.limit(publicQuery.PAGE_SIZE + 1);
}

function pageData(snapshot) {
  const docs = snapshot.docs.slice(0, publicQuery.PAGE_SIZE);
  const last = docs[docs.length - 1];
  const rawStart = last?.get('startAt');
  const nextPageCursor = snapshot.docs.length > publicQuery.PAGE_SIZE
    ? publicQuery.encodeCursor(rawStart?.toDate ? rawStart.toDate().toISOString() : rawStart, last.get('endAt'), last.id)
    : null;
  return { docs, nextPageCursor };
}

function boundedAdminEventQuery(query, range, cursor) {
  return boundedEventQuery(query, range, cursor);
}

function parseEventRange(from, to) {
  if (from === undefined && to === undefined) return publicQuery.defaultFeedRange();
  try { return publicQuery.validateRange(from, to); }
  catch (error) { throw new HttpsError('invalid-argument', error.message); }
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


const AUTH_SETTINGS_DOC = () => db.collection('calendarSettings').doc('auth');

async function isPasswordLoginDisabled() {
  const snap = await AUTH_SETTINGS_DOC().get();
  return snap.exists && snap.data().passwordLoginDisabled === true;
}

async function sessionPermitted(token) {
  const provider = token?.firebase?.sign_in_provider || '';
  if (provider !== 'password') return true;
  return sessionAllowed({ provider, passwordLoginDisabled: await isPasswordLoginDisabled() });
}

async function requireAdmin(auth,moduleId='events-bookings') {
 if(!auth)throw new HttpsError('unauthenticated','Sign in as an admin to perform this action.');
 const actor=await resolveAdmin(db,auth.uid,auth.token,moduleId);
 if(!actor)throw new HttpsError('permission-denied','You do not have access to this admin module.');
 return actor;
}
async function isSubmitterAdmin(auth){return !!(auth&&await resolveAdmin(db,auth.uid,auth.token,'events-bookings'));}

function sanitizeTimeMode(value) {
  return value === 'allDay' || value === 'allNight' ? value : 'custom';
}

function sanitizeVisibility(value) {
  return value === 'public' || value === 'private' ? value : null;
}

/** Program details and prayer-based ("variable") times. Prayer times only apply to "Set times" bookings. */
function programFields(data, timeMode) {
  const custom = sanitizeTimeMode(timeMode !== undefined ? timeMode : data.timeMode) === 'custom';
  return {
    speakerName: data.speakerName ? String(data.speakerName).slice(0, 200) : '',
    programDetails: data.programDetails ? String(data.programDetails).slice(0, 2000) : '',
    startPrayer: custom ? sanitizePrayer(data.startPrayer) : null,
    endPrayer: custom ? sanitizePrayer(data.endPrayer) : null
  };
}

/** Server-side source of truth for prayer-timed bookings: recompute the instants on the booking's civil date. */
function applyPrayerTimes(dates, fields) {
  if (!fields.startPrayer && !fields.endPrayer) return dates;
  const start = toOrgTimeParts(dates.startAt);
  const r = resolvePrayerInstants(start.dateStr, {
    start: start.timeStr, end: toOrgTimeParts(dates.endAt).timeStr,
    startPrayer: fields.startPrayer, endPrayer: fields.endPrayer
  });
  return r && r.startAt && r.endAt ? { ...dates, startAt: r.startAt, endAt: r.endAt } : dates;
}

async function getActiveDoc(collectionName, id, label) {
  if (!id) throw new HttpsError('invalid-argument', `${label} is required.`);
  const snap = await db.collection(collectionName).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', `${label} not found.`);
  return { id: snap.id, ...snap.data() };
}

/** Load the bookings a candidate at `venueId` can conflict with: same-venue bookings plus bookings at
 * whole-site venues (or every booking when the candidate itself is a whole-site venue). Each carries its
 * own venue buffer as _buf. Read-only; safe inside or outside a transaction. */
async function loadConflictScope(venueId, tx, startAt, endAt, bufferOverride, cachedVenues) {
  const get = (q) => (tx ? tx.get(q) : q.get());
  const venueSnap = cachedVenues ? null : await get(db.collection('venues').limit(MAX_VENUES_FOR_CONFLICTS + 1));
  const venues = cachedVenues || venueSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (venues.length > MAX_VENUES_FOR_CONFLICTS) {
    throw new HttpsError('resource-exhausted', 'There are too many configured venues to check this request safely.');
  }
  const vById = new Map(venues.map(v => [v.id, v]));
  const cand = vById.get(venueId);
  if (!cand) throw new HttpsError('not-found', 'Venue not found.');
  const candBuf = bufferOverride !== undefined ? bufferOverride : resolveBufferHours(cand);
  const ids = isWholeSiteVenue(cand)
    ? venues.map(v => v.id)
    : [venueId, ...venues.filter(isWholeSiteVenue).map(v => v.id)];
  const scopedIds = [...new Set(ids)];
  const maxExistingBuffer = Math.max(0, ...scopedIds.map(id => resolveBufferHours(vById.get(id))));
  const startMs = new Date(startAt).getTime(), endMs = new Date(endAt).getTime();
  const lowerMs = startMs - maxExistingBuffer * 60 * 60 * 1000;
  const upperMs = endMs + Math.max(0, candBuf) * 60 * 60 * 1000;
  if (!Number.isFinite(lowerMs) || !Number.isFinite(upperMs) || upperMs <= lowerMs ||
      upperMs - lowerMs > MAX_BOOKING_DURATION_MS) {
    throw new HttpsError('invalid-argument', 'The requested booking window is too long to check safely.');
  }
  const range = { from: new Date(lowerMs).toISOString(), to: new Date(upperMs).toISOString() };
  const events = [];
  for (const id of scopedIds) {
    const remaining = MAX_CONFLICT_CANDIDATES - events.length;
    const query = conflictScopeQuery(db, id, ACTIVE_FOR_CONFLICTS, range, remaining + 1);
    const snapshot = await get(query);
    if (snapshot.size > remaining) {
      throw new HttpsError('resource-exhausted', 'Too many bookings overlap this time window to check safely. Choose a narrower time or contact the MWA team.');
    }
    snapshot.forEach(doc => events.push({
      id: doc.id,
      ...doc.data(),
      _buf: resolveBufferHours(vById.get(doc.data().venueId))
    }));
  }
  return { candBuf, events, vById };
}

/** Find other pending/confirmed bookings that conflict with a candidate slot: same venue or a whole-site
 * venue, symmetric, each booking occupying [start, end + its venue's buffer]. */
async function findOverlaps(venueId, startAt, endAt, excludeId, tx, bufferHours, cachedVenues) {
  const { candBuf, events, vById } = await loadConflictScope(venueId, tx, startAt, endAt, bufferHours, cachedVenues);
  const cand = { startAt, endAt, _buf: candBuf };
  return events
    .filter(d => d.id !== excludeId && rangesConflict(cand, d, 0))
    .map(d => ({
      id: d.id, title: d.title, status: d.status, startAt: d.startAt, endAt: d.endAt,
      departmentName: d.departmentName, contactName: d.contactName, visibility: d.visibility,
      venueName: d.venueName || (vById.get(d.venueId) || {}).name || ''
    }));
}

/** Same rule for many candidate ranges at one venue with a single read. `excludeIds` are ignored as "existing". */
async function bulkOverlaps(venueId, items, excludeIds, bufferHours) {
  const starts = items.map(item => new Date(item.startAt).getTime());
  const ends = items.map(item => new Date(item.endAt).getTime());
  const { candBuf, events } = await loadConflictScope(
    venueId,
    undefined,
    new Date(Math.min(...starts)).toISOString(),
    new Date(Math.max(...ends)).toISOString(),
    bufferHours
  );
  const skip = new Set(excludeIds || []);
  const existing = events.filter(d => !skip.has(d.id));
  const result = new Map();
  const details = new Map();
  for (const item of items) {
    const hits = existing.filter(o => rangesConflict({ ...item, _buf: candBuf }, o, 0));
    result.set(item.id, hits.map(o => o.id));
    details.set(item.id, hits.map(o => ({ id: o.id, title: o.title || '', status: o.status, startAt: o.startAt, endAt: o.endAt })));
  }
  result.details = details;
  return result;
}

const refreshConflictNeighborhood = createConflictNeighborhoodRefresher({
  db, HttpsError, activeStatuses: ACTIVE_FOR_CONFLICTS,
  maxCandidates: MAX_CONFLICT_CANDIDATES,
  maxVenues: MAX_VENUES_FOR_CONFLICTS,
  findOverlaps, resolveBufferHours, rangesConflict
});

/** Recompute stored hasConflict/conflictWith for EVERY active booking (same-venue + whole-site, buffer-aware,
 * symmetric), writing only documents whose flags changed. The argument is kept for call-site compatibility:
 * a whole-site booking affects other venues, so the full recompute is the correct scope. */
async function recomputeVenueConflicts() {
  const [venueSnap, evSnap] = await Promise.all([
    db.collection('venues').get(),
    db.collection('events').where('status', 'in', ACTIVE_FOR_CONFLICTS).get()
  ]);
  const venues = venueSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const docs = evSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const map = computeAllConflicts(docs, venues);
  const writes = [];
  for (const d of docs) {
    if (!map.has(d.id)) continue;
    const ids = map.get(d.id).slice().sort();
    const prev = (d.conflictWith || []).slice().sort();
    const has = ids.length > 0;
    if (Boolean(d.hasConflict) !== has || ids.join(',') !== prev.join(',')) {
      writes.push((batch) => batch.update(db.collection('events').doc(d.id), { hasConflict: has, conflictWith: ids }));
    }
  }
  await commitInChunks(writes);
  return writes.length;
}

async function commitInChunks(writes, size = 400) {
  return commitBatches(db, writes, size);
}

async function writeAudit(entry) {
  await db.collection('auditLog').add(require('./auditModel').auditEntry(entry));
}

async function getHijriOverrides() {
  const snap = await db.collection('calendarSettings').doc('hijri').get();
  return snap.exists ? (snap.data().overrides || []) : [];
}

function hijriInfoFor(dateKey, overrides) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const h = adjustedGregorianToIslamic(y, m, d, overrides);
  if (!h.year) return null;
  const monthName = (HIJRI_MONTHS.find(x => x.value === h.month) || {}).name || '';
  return { day: h.day, month: h.month, monthName, year: h.year };
}

function dateKeyOf(iso) {
  // Organisation timezone for day-boundary purposes.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function requireAllowedBookingType(department, isAdmin) {
  if (!canSubmitBookingType(department, isAdmin)) throw new HttpsError('permission-denied', 'Public users may only submit Events Booking requests. Sign in as an admin to use another booking type.');
}

function validateBookingPayload(data) {
  try { return bookingVerification.canonicalBookingPayload(data); }
  catch (error) { throw new HttpsError('invalid-argument', error.message); }
}

async function prepareBookingPayload(data, submitterIsAdmin) {
  const canonical = validateBookingPayload(data);
  if (submitterIsAdmin && !canonical.contactEmail) {
    throw new HttpsError('invalid-argument', 'Contact email is required for admin-entered bookings.');
  }
  const venue = await getActiveDoc('venues', canonical.venueId, 'Venue');
  const department = await getActiveDoc('departments', canonical.departmentId, 'Booking type');
  requireAllowedBookingType(department, submitterIsAdmin);
  const overrides = await getHijriOverrides();
  const program = programFields({ ...data, ...canonical });
  const resolvedDates = applyPrayerTimes(resolveBookingDates({ ...data, ...canonical }, overrides), program);
  if (!(new Date(resolvedDates.startAt) < new Date(resolvedDates.endAt))) {
    throw new HttpsError('invalid-argument', 'End time must be after start time.');
  }
  if (!validateBookingLeadTime(resolvedDates.startAt, submitterIsAdmin)) {
    throw new HttpsError(
      'failed-precondition',
      `Public bookings must start at least ${MIN_PUBLIC_LEAD_HOURS} hours from now. Please choose a later date and time.`
    );
  }
  const prepared = validateBookingPayload({ ...canonical, ...resolvedDates, ...program });
  if(!submitterIsAdmin&&(Date.parse(prepared.endAt)-Date.parse(prepared.startAt)>7*86400000||Date.parse(prepared.startAt)>Date.now()+2*366*86400000))throw new HttpsError('invalid-argument','Public bookings must be within two years and last no more than seven days.');
  return { prepared, venue, department, overrides, program };
}

function requireCallableAppCheck(request) {
  if (!request.app?.appId) {
    throw new HttpsError('failed-precondition', 'Refresh the page and try again with the MWA security check enabled.');
  }
}

async function requireRestAppCheck(req) {
  const token = req.get('X-Firebase-AppCheck') || '';
  if (!token) throw new HttpsError('failed-precondition', 'Refresh the page and try again with the MWA security check enabled.');
  try { await getAppCheck().verifyToken(token); }
  catch { throw new HttpsError('permission-denied', 'The MWA security check could not be verified.'); }
}

function requestIp(request) {
  return request.rawRequest?.ip || request.ip || request.rawRequest?.socket?.remoteAddress || 'unknown';
}

async function takeVerificationRateLimit(contact, ip) {
  const secret = BOOKING_OTP_HMAC_KEY.value();
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new HttpsError('failed-precondition', 'Booking verification is not configured.');
  }
  const now = Date.now(), windowMs = 15 * 60 * 1000;
  const limits = [
    { ref: db.collection('_bookingVerificationRateLimits').doc(bookingVerification.rateLimitId(secret, 'contact', contact)), max: 3 },
    { ref: db.collection('_bookingVerificationRateLimits').doc(bookingVerification.rateLimitId(secret, 'ip', ip)), max: 10 },
    { ref: db.collection('_bookingVerificationRateLimits').doc(bookingVerification.rateLimitId(secret, 'global', 'all')), max: 100 }
  ];
  let blocked = false;
  await db.runTransaction(async tx => {
    const snapshots = await Promise.all(limits.map(limit => tx.get(limit.ref)));
    const windows = snapshots.map((snapshot, index) => {
      const current = snapshot.exists ? snapshot.data() : {};
      const active = Number(current.windowStartedAt) > now - windowMs;
      return {
        limit: limits[index],
        count: active ? Number(current.count) || 0 : 0,
        startedAt: active ? current.windowStartedAt : now
      };
    });
    if (windows.some(window => window.count >= window.limit.max)) {
      blocked = true;
      return;
    }
    for (const window of windows) {
      tx.set(window.limit.ref, {
        count: window.count + 1,
        windowStartedAt: window.startedAt,
        expiresAt: Timestamp.fromMillis(now + windowMs)
      });
    }
  });
  if (blocked) throw new HttpsError('resource-exhausted', 'Too many verification attempts. Please wait before trying again.');
}

function sessionHash(sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(sessionId)) {
    throw new HttpsError('invalid-argument', 'Refresh the page before starting verification.');
  }
  return require('node:crypto').createHash('sha256').update(sessionId).digest('hex');
}

const createBookingSubmission = createBookingSubmissionService({
  deliverSubmission,
  db, FieldValue, Timestamp, HttpsError, bookingVerification, prepareBookingPayload,
  findOverlaps, resolveBufferHours, refreshConflictNeighborhood,
  sessionHash, sanitizeVisibility,
  auditEntry: require('./auditModel').auditEntry,
  issueLink: require('./emailBookingLink').issueLink,
  sendAll, notify, hijriInfoFor, dateKeyOf, logger
});

const BOOKING_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_BOOKING_CODE_ATTEMPTS = 5;
const timestampMillis = value => value?.toMillis ? value.toMillis() : Number(value);

exports.startBookingVerification = onCall({ cors: true, secrets: [...emailSecrets, BOOKING_OTP_HMAC_KEY] }, async request => {
  requireCallableAppCheck(request);
  const { method, sessionId, booking, contactEmail, contactPhone } = request.data || {};
  if (!bookingVerification.METHODS.has(method)) throw new HttpsError('invalid-argument', 'Choose email or mobile verification.');
  const currentSessionHash = sessionHash(sessionId);
  // New visitors verify contact before entering booking details; retain old-client compatibility.
  const prepared = booking ? (await prepareBookingPayload(booking, false)).prepared : {contactEmail,contactPhone};
  let contact;
  try {
    contact = bookingVerification.selectedContact(method, prepared);
  } catch (error) {
    throw new HttpsError('invalid-argument', error.message);
  }
  const proofPayload = method === 'mobile' ? { ...prepared, contactPhone: contact } : prepared;
  const key = BOOKING_OTP_HMAC_KEY.value();
  if (typeof key !== 'string' || key.length < 32) throw new HttpsError('failed-precondition', 'Booking verification is not configured.');

  await takeVerificationRateLimit(contact, requestIp(request));
  const challengeId = bookingVerification.newChallengeId();
  const challengeRef = db.collection('_bookingVerificationChallenges').doc(challengeId);
  const sessionRef = db.collection('_bookingVerificationSessions').doc(currentSessionHash);
  const code = method === 'email' ? bookingVerification.newEmailCode() : null;
  const expiresAt = Date.now() + BOOKING_CHALLENGE_TTL_MS;
  await db.runTransaction(async tx => {
    const sessionSnapshot = await tx.get(sessionRef);
    const previousId = sessionSnapshot.exists ? sessionSnapshot.data().challengeId : null;
    const previousRef = typeof previousId === 'string' && /^[A-Za-z0-9_-]{40,50}$/.test(previousId)
      ? db.collection('_bookingVerificationChallenges').doc(previousId) : null;
    const previousSnapshot = previousRef ? await tx.get(previousRef) : null;
    if (previousSnapshot?.exists && !['consumed', 'superseded'].includes(previousSnapshot.data().status)) {
      tx.update(previousRef, { status: 'superseded', supersededAt: FieldValue.serverTimestamp() });
    }
    tx.create(challengeRef, {
      purpose: 'public-booking',
      method,
      contact,
      ...(booking ? {payloadDigest: bookingVerification.payloadDigest(proofPayload)} : {scope:'contact'}),
      sessionIdHash: currentSessionHash,
      status: method === 'email' ? 'sending' : 'awaiting-phone',
      attempts: 0,
      expiresAt: Timestamp.fromMillis(expiresAt),
      createdAt: FieldValue.serverTimestamp(),
      ...(code ? { codeVerifier: bookingVerification.codeVerifier(key, challengeId, code) } : {})
    });
    tx.set(sessionRef, {
      challengeId,
      expiresAt: Timestamp.fromMillis(expiresAt),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  if (method === 'email') {
    const result = await sendAll([notify.verificationCode(contact,code)]);
    if (result[0]?.sent !== true) {
      await challengeRef.update({ status: 'delivery-failed', codeVerifier: FieldValue.delete() });
      throw new HttpsError('unavailable', 'We could not send the verification code. Try again later or choose mobile verification.');
    }
    await challengeRef.update({ status: 'active' });
  }
  return {
    challengeId,
    expiresAt,
    resendAfterMs: 60_000,
    method,
    maskedContact: bookingVerification.maskContact(method, contact)
  };
});

exports.verifyBookingEmailCode = onCall({ cors: true, secrets: [BOOKING_OTP_HMAC_KEY] }, async request => {
  requireCallableAppCheck(request);
  const { challengeId, code, sessionId } = request.data || {};
  if (typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(challengeId) ||
      typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Enter the six-digit verification code.');
  }
  const currentSessionHash = sessionHash(sessionId);
  const challengeRef = db.collection('_bookingVerificationChallenges').doc(challengeId);
  const sessionRef = db.collection('_bookingVerificationSessions').doc(currentSessionHash);
  let outcome = '';
  await db.runTransaction(async tx => {
    const [challengeSnapshot, sessionSnapshot] = await Promise.all([tx.get(challengeRef), tx.get(sessionRef)]);
    const challenge = challengeSnapshot.exists ? challengeSnapshot.data() : null;
    if (!challenge || !sessionSnapshot.exists || sessionSnapshot.data().challengeId !== challengeId ||
        challenge.sessionIdHash !== currentSessionHash || challenge.purpose !== 'public-booking' ||
        challenge.method !== 'email' || timestampMillis(challenge.expiresAt) <= Date.now() ||
        !['active', 'verified'].includes(challenge.status)) {
      outcome = 'expired';
      return;
    }
    if (challenge.status === 'verified') {
      outcome = 'verified';
      return;
    }
    const expected = bookingVerification.codeVerifier(BOOKING_OTP_HMAC_KEY.value(), challengeId, code);
    if (!bookingVerification.equalVerifier(challenge.codeVerifier, expected)) {
      const attempts = (Number(challenge.attempts) || 0) + 1;
      tx.update(challengeRef, {
        attempts,
        ...(attempts >= MAX_BOOKING_CODE_ATTEMPTS
          ? { status: 'locked', codeVerifier: FieldValue.delete() }
          : {})
      });
      outcome = attempts >= MAX_BOOKING_CODE_ATTEMPTS ? 'locked' : 'invalid';
      return;
    }
    tx.update(challengeRef, {
      status: 'verified',
      verifiedAt: FieldValue.serverTimestamp(),
      codeVerifier: FieldValue.delete()
    });
    outcome = 'verified';
  });
  if (outcome !== 'verified') {
    const message = outcome === 'expired'
      ? 'This verification code expired. Start verification again.'
      : outcome === 'locked' ? 'Too many incorrect codes. Start verification again.' : 'That code is not correct. Check it and try again.';
    throw new HttpsError(outcome === 'expired' ? 'deadline-exceeded' : 'invalid-argument', message);
  }
  return { verified: true };
});

exports.verifyBookingMobile = onCall({ cors: true }, async request => {
  requireCallableAppCheck(request);
  const { challengeId, idToken, sessionId } = request.data || {};
  if (typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(challengeId) ||
      typeof idToken !== 'string' || idToken.length > 12_000) {
    throw new HttpsError('invalid-argument', 'Complete mobile verification again.');
  }
  const currentSessionHash = sessionHash(sessionId);
  let decoded;
  try { decoded = await getAuth().verifyIdToken(idToken, true); }
  catch { throw new HttpsError('permission-denied', 'The mobile verification could not be confirmed. Try again or choose email.'); }
  const phone = decoded.phone_number;
  const signedInAt = Number(decoded.auth_time) * 1000;
  if (decoded.firebase?.sign_in_provider !== 'phone' || !phone ||
      !Number.isFinite(signedInAt) || Date.now() - signedInAt > BOOKING_CHALLENGE_TTL_MS ||
      signedInAt > Date.now() + 60_000) {
    throw new HttpsError('permission-denied', 'Use a fresh Firebase Phone Auth verification for this booking.');
  }

  const challengeRef = db.collection('_bookingVerificationChallenges').doc(challengeId);
  const sessionRef = db.collection('_bookingVerificationSessions').doc(currentSessionHash);
  let outcome = '';
  await db.runTransaction(async tx => {
    const [challengeSnapshot, sessionSnapshot] = await Promise.all([tx.get(challengeRef), tx.get(sessionRef)]);
    const challenge = challengeSnapshot.exists ? challengeSnapshot.data() : null;
    if (!challenge || !sessionSnapshot.exists || sessionSnapshot.data().challengeId !== challengeId ||
        challenge.sessionIdHash !== currentSessionHash || challenge.purpose !== 'public-booking' ||
        challenge.method !== 'mobile' || timestampMillis(challenge.expiresAt) <= Date.now() ||
        !['awaiting-phone', 'verified'].includes(challenge.status)) {
      outcome = 'expired';
      return;
    }
    let normalizedPhone;
    try { normalizedPhone = bookingVerification.normalizePhone(phone); }
    catch { outcome = 'mismatch'; return; }
    if (normalizedPhone !== challenge.contact) {
      outcome = 'mismatch';
      return;
    }
    if (challenge.status !== 'verified') {
      tx.update(challengeRef, { status: 'verified', verifiedAt: FieldValue.serverTimestamp() });
    }
    outcome = 'verified';
  });
  if (outcome !== 'verified') {
    throw new HttpsError(
      outcome === 'expired' ? 'deadline-exceeded' : 'permission-denied',
      outcome === 'expired'
        ? 'This mobile verification expired. Start again.'
        : 'The verified mobile number does not match your selected contact.'
    );
  }
  return { verified: true };
});

// Public projection (see publicProjection.js): confirmed+public in full; confirmed
// private and pending masked; everything else (rejected/cancelled) dropped (null).
function sanitizePublicEvent(d, id, overrides) {
  return projectPublicEvent(d, id, hijriInfoFor(dateKeyOf(d.startAt), overrides));
}

const PUBLIC_STATUSES = ['pending', 'confirmed'];
// â”€â”€ Callable: public booking submission â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.submitBooking = onCall({ cors: true, secrets: [...emailSecrets, BOOKING_OTP_HMAC_KEY] }, async request => {
  const isAdmin = await isSubmitterAdmin(request.auth);
  const authenticated = require('./bookingIdentity').authenticatedBookingIdentity(request.auth);
  if (!isAdmin) requireCallableAppCheck(request);
  return createBookingSubmission(request.data || {}, {
    isAdmin,
    authenticated,
    uid: authenticated ? request.auth.uid : null,
    email: authenticated ? normalizeEmail(request.auth.token.email) : ''
  });
});

// â”€â”€ Callable: admin confirm/reject/cancel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.decideBooking = onCall({ cors: true, secrets: emailSecrets }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { eventId, status, visibility, note } = request.data || {};
  if (!eventId || !STATUSES.includes(status) || status === 'pending') {
    throw new HttpsError('invalid-argument', 'eventId and a valid target status are required.');
  }

  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const before = snap.data();

  let hasConflict = before.hasConflict;
  let conflictWith = before.conflictWith || [];
  if (status === 'confirmed') {
    const overlaps = await findOverlaps(before.venueId, before.startAt, before.endAt, eventId);
    hasConflict = overlaps.length > 0;
    conflictWith = overlaps.map(o => o.id);
  }

  const patch = {
    status,
    hasConflict, conflictWith,
    decidedBy: admin.uid, decidedByEmail: admin.email,
    decidedAt: FieldValue.serverTimestamp(),
    decisionNote: note || '',
    updatedAt: FieldValue.serverTimestamp()
  };
  // Visibility is now set at submission time and editable by an admin at any
  // point (see updateBooking); a decision only overrides it if the admin
  // explicitly picks one here, otherwise the booking's existing visibility is
  // preserved rather than being silently reset to private.
  const explicitVisibility = sanitizeVisibility(visibility);
  if (explicitVisibility) patch.visibility = explicitVisibility;

  await ref.update(patch);
  await refreshConflictNeighborhood([{ id: eventId, before, after: { ...before, ...patch } }]);
  await writeAudit({
    entityType: 'event', entityId: eventId, action: `status_${status}`,
    userId: admin.uid, userEmail: admin.email, note: note || '',
    diff: { from: before.status, to: status }
  });

  // Rows 3-5: requester always; cancellations also go to the admin inbox. Confirmations carry an .ics.
  const decided = { ...before, ...patch };
  const dHijri = hijriInfoFor(dateKeyOf(before.startAt), await getHijriOverrides());
  const reqMail = notify.decisionRequester(decided, dHijri, status, note);
  if (reqMail && status === 'confirmed') reqMail.attachments = [notify.icsAttachment(decided, eventId)];
  await sendAll([reqMail, status === 'cancelled' ? notify.cancellationAdmin(decided, dHijri, admin.email, note) : null]);

  return { id: eventId, status, hasConflict };
});

// â”€â”€ Callable: admin edit of an existing booking's core fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.updateBooking = onCall({ cors: true, secrets: emailSecrets }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { eventId, patch } = request.data || {};
  const scope = normalizeScope((request.data || {}).scope);
  if (!eventId || !patch) throw new HttpsError('invalid-argument', 'eventId and patch are required.');

  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const before = snap.data();

  const next = { ...before, ...patch };
  const update = {
    title: patch.title ?? before.title,
    departmentId: patch.departmentId ?? before.departmentId,
    venueId: patch.venueId ?? before.venueId,
    startAt: patch.startAt ?? before.startAt,
    endAt: patch.endAt ?? before.endAt,
    contactName: patch.contactName ?? before.contactName,
    contactEmail: patch.contactEmail ?? before.contactEmail,
    contactPhone: patch.contactPhone ?? before.contactPhone,
    notes: patch.notes ?? before.notes,
    updatedAt: FieldValue.serverTimestamp()
  };
  if (patch.timeMode !== undefined) update.timeMode = sanitizeTimeMode(patch.timeMode);
  const program = programFields({ ...before, ...patch }, update.timeMode !== undefined ? update.timeMode : before.timeMode);
  Object.assign(update, program);
  Object.assign(update, applyPrayerTimes({ startAt: update.startAt, endAt: update.endAt }, program));
  if (!(new Date(update.startAt) < new Date(update.endAt))) throw new HttpsError('invalid-argument', 'End time must be after start time.');
  const nowIso = new Date().toISOString();

  // Admins can change a booking's public/private visibility at any point,
  // independent of its status â€” not only at confirm/decision time.
  const explicitVisibility = sanitizeVisibility(patch.visibility);
  if (explicitVisibility) update.visibility = explicitVisibility;

  if (update.departmentId !== before.departmentId) {
    const dept = await getActiveDoc('departments', update.departmentId, 'Booking type');
    update.departmentName = dept.name;
  }
  if (update.venueId !== before.venueId) {
    const venue = await getActiveDoc('venues', update.venueId, 'Venue');
    update.venueName = venue.name;
  }

  // Preserve-source-date rule: if this booking was Hijri-sourced and the admin
  // is now setting a startAt/endAt that differs from what its source hijriDate
  // currently resolves to, that's an explicit manual reschedule â€” detach it
  // from the Hijri anchor (switch to dateBasis 'gregorian', clear hijriDate) so
  // a later moon-sighting adjustment doesn't silently move it again. If the
  // edit didn't touch the date/time, the Hijri anchor is left untouched.
  if (before.dateBasis === 'hijri' && before.hijriDate) {
    const overrides = await getHijriOverrides();
    const resolvedBefore = resolveBookingDates(before, overrides);
    // Compare civil dates only: a time-of-day edit keeps the Hijri anchor (the resolver preserves time-of-day).
    if (dateKeyOf(update.startAt) !== dateKeyOf(resolvedBefore.startAt) || dateKeyOf(update.endAt) !== dateKeyOf(resolvedBefore.endAt)) {
      update.dateBasis = 'gregorian';
      update.hijriDate = null;
    }
  }

  if (update.venueId !== before.venueId || update.startAt !== before.startAt || update.endAt !== before.endAt) {
    const overlaps = await findOverlaps(update.venueId, update.startAt, update.endAt, eventId);
    update.hasConflict = overlaps.length > 0;
    update.conflictWith = overlaps.map(o => o.id);
  }

  // Scoped edits of a recurring series ('future' / 'all'): shared fields and the
  // time-of-day are applied to every targeted occurrence, each keeping its own date.
  // Moving the date is only allowed for a single occurrence.
  let seriesTargets = [];
  let seriesConflictChanges = [];
  if (scope !== 'single' && before.seriesId) {
    if (dateKeyOf(update.startAt) !== dateKeyOf(before.startAt)) {
      throw new HttpsError('invalid-argument', 'Dates can only be changed for a single occurrence. Choose "This occurrence only", or delete and recreate the series.');
    }
    const seriesSnap = await db.collection('events').where('seriesId', '==', before.seriesId)
      .limit(MAX_SERIES_OCCURRENCES + 1).get();
    if (seriesSnap.size > MAX_SERIES_OCCURRENCES) {
      throw new HttpsError('resource-exhausted', 'This booking series is too large to update safely in one request.');
    }
    const docs = seriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Past occurrences (already started) are history: never touched by multi-occurrence scopes.
    seriesTargets = selectSeriesTargets(docs, { id: eventId, ...before }, scope, nowIso).filter(t => t.id !== eventId);
  }

  const anchorLocked = scope !== 'single' && Boolean(before.seriesId) && before.startAt <= nowIso;
  if (anchorLocked && !seriesTargets.length) {
    throw new HttpsError('failed-precondition', 'No upcoming occurrences to change. Past occurrences are kept as records.');
  }
  if (!anchorLocked) await ref.update(update);

  let seriesUpdated = 0;
  if (seriesTargets.length) {
    const shared = {};
    for (const k of ['title', 'departmentId', 'departmentName', 'venueId', 'venueName', 'contactName', 'contactEmail', 'contactPhone', 'notes', 'visibility', 'speakerName', 'programDetails', 'startPrayer', 'endPrayer']) {
      if (update[k] !== undefined) shared[k] = update[k];
    }
    const newStart = toOrgTimeParts(update.startAt).timeStr;
    const newEnd = toOrgTimeParts(update.endAt).timeStr;
    const endNextDay = dateKeyOf(update.endAt) !== dateKeyOf(update.startAt);
    const prayerTimed = Boolean(program.startPrayer || program.endPrayer);
    const timeChanged = prayerTimed || newStart !== toOrgTimeParts(before.startAt).timeStr || newEnd !== toOrgTimeParts(before.endAt).timeStr;
    const retimed = seriesTargets.map(t => {
      const times = timeChanged ? applyPrayerTimes(retimeOccurrence(t, newStart, newEnd, endNextDay), program) : { startAt: t.startAt, endAt: t.endAt };
      return { id: t.id, startAt: times.startAt, endAt: times.endAt };
    });
    const targetById = new Map(seriesTargets.map(target => [target.id, target]));
    seriesConflictChanges = retimed.map(item => {
      const target = targetById.get(item.id);
      return {
        id: item.id,
        before: target,
        after: {
          ...target, ...shared,
          ...(timeChanged ? { startAt: item.startAt, endAt: item.endAt } : {}),
          ...(update.timeMode ? { timeMode: update.timeMode } : {})
        }
      };
    });
    const venueSnap = await db.collection('venues').doc(update.venueId).get();
    const overlapMap = await bulkOverlaps(update.venueId, retimed, [eventId, ...retimed.map(r => r.id)], resolveBufferHours(venueSnap.exists ? venueSnap.data() : null));
    let batch = db.batch();
    let ops = 0;
    for (const r of retimed) {
      const ids = overlapMap.get(r.id) || [];
      const patchDoc = { ...shared, ...(timeChanged ? { startAt: r.startAt, endAt: r.endAt } : {}), ...(update.timeMode ? { timeMode: update.timeMode } : {}), hasConflict: ids.length > 0, conflictWith: ids, updatedAt: FieldValue.serverTimestamp() };
      batch.update(db.collection('events').doc(r.id), patchDoc);
      ops += 1; seriesUpdated += 1;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops) await batch.commit();
    await writeAudit({
      entityType: 'series', entityId: before.seriesId, action: 'series_updated',
      userId: admin.uid, userEmail: admin.email,
      note: `Scope "${scope}": applied edit to ${seriesUpdated + (anchorLocked ? 0 : 1)} upcoming occurrence(s) (anchor ${eventId}); past occurrences unchanged.`
    });
  }

  await writeAudit({
    entityType: 'event', entityId: eventId, action: 'updated',
    userId: admin.uid, userEmail: admin.email,
    diff: update.visibility && update.visibility !== before.visibility
      ? { visibility: { from: before.visibility || 'private', to: update.visibility } }
      : null
  });

  let fresh = await ref.get();
  // Row 6: tell the requester only when a confirmed booking's date, time or venue changed (one email per edit).
  let after = fresh.exists ? fresh.data() : { ...before, ...update };
  const conflictChanges = anchorLocked
    ? seriesConflictChanges
    : [...seriesConflictChanges, { id: eventId, before, after }];
  for (let offset = 0; offset < conflictChanges.length; offset += CONFLICT_REFRESH_BATCH_SIZE) {
    await refreshConflictNeighborhood(conflictChanges.slice(offset, offset + CONFLICT_REFRESH_BATCH_SIZE));
  }
  fresh = await ref.get();
  after = fresh.exists ? fresh.data() : after;
  if (before.status === 'confirmed' && notify.scheduleChanged(before, after)) {
    const uHijri = hijriInfoFor(dateKeyOf(after.startAt), await getHijriOverrides());
    await sendAll([notify.updateRequester(after, uHijri, { previous: before, occurrences: seriesUpdated + (anchorLocked ? 0 : 1) })]);
  }
  return { id: eventId, hasConflict: fresh.exists ? Boolean(fresh.data().hasConflict) : false, seriesUpdated };
});

// â”€â”€ Callable: admin-only recurring booking creation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Expands the rule server-side (recurrence.js: Sydney civil time, DST-safe, Hijri-anchored),
// flags (never blocks) per-occurrence venue overlaps using the venue buffer, and writes
// every occurrence with a shared seriesId. Admin-created: defaults to confirmed + private.
async function expandSeries(data) {
  for (const f of ['title', 'departmentId', 'venueId', 'contactName', 'contactEmail']) {
    if (!data[f]) throw new HttpsError('invalid-argument', `Missing required field: ${f}`);
  }
  const venue = await getActiveDoc('venues', data.venueId, 'Venue');
  const department = await getActiveDoc('departments', data.departmentId, 'Booking type');
  const overrides = await getHijriOverrides();
  let occurrences;
  try {
    occurrences = generateOccurrences(data.recurrence, overrides);
  } catch (err) {
    if (err instanceof RecurrenceError) throw new HttpsError('invalid-argument', err.message);
    throw err;
  }
  // Prayer-timed series: each occurrence follows the prayer on its own date.
  const program = programFields(data);
  occurrences = occurrences.map(o => ({ ...o, ...applyPrayerTimes({ startAt: o.startAt, endAt: o.endAt }, program) }));
  const refs = occurrences.map(() => db.collection('events').doc());
  const overlapMap = await bulkOverlaps(
    data.venueId,
    occurrences.map((o, i) => ({ id: refs[i].id, startAt: o.startAt, endAt: o.endAt })),
    [], resolveBufferHours(venue)
  );
  return { venue, department, occurrences, refs, overlapMap };
}

// â”€â”€ Callable: admin-only preview of a series (exact count, dates, per-occurrence conflicts) â”€â”€
exports.previewRecurringBooking = onCall({ cors: true }, async (request) => {
  await requireAdmin(request.auth);
  const { occurrences, refs, overlapMap } = await expandSeries(request.data || {});
  const items = occurrences.map((o, i) => {
    const conflicts = overlapMap.details.get(refs[i].id) || [];
    return {
      index: o.index, startAt: o.startAt, endAt: o.endAt,
      hijri: o.hijriDisplay || o.hijriDate || null,
      hasConflict: conflicts.length > 0, conflicts
    };
  });
  return { count: items.length, conflicts: items.filter(i => i.hasConflict).length, occurrences: items };
});

exports.createRecurringBooking = onCall({ cors: true, secrets: emailSecrets }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const data = request.data || {};
  const { venue, department, occurrences, refs, overlapMap } = await expandSeries(data);

  const status = 'confirmed';
  if([...overlapMap.values()].some(ids=>ids.length))throw new HttpsError('failed-precondition','Resolve overlapping bookings before creating an admin series.');
  const visibility = sanitizeVisibility(data.visibility) || 'public';
  const rule = data.recurrence;
  const seriesId = db.collection('events').doc().id;
  const recurrence = {
    basis: rule.basis === 'hijri' ? 'hijri' : 'gregorian',
    frequency: rule.frequency, repeatEvery: Number(rule.repeatEvery),
    endMode: rule.endMode,
    endDate: rule.endMode === 'date' ? rule.endDate : null,
    count: rule.endMode === 'count' ? Number(rule.count) : null,
    startTime: rule.startTime, endTime: rule.endTime,
    endNextDay: rule.endNextDay === true,
    timeMode: sanitizeTimeMode(data.timeMode)
  };

  let conflicts = 0;
  const writes = occurrences.map((o, i) => {
    const ids = overlapMap.get(refs[i].id) || [];
    if (ids.length) conflicts += 1;
    return (batch) => batch.set(refs[i], {
      title: String(data.title).slice(0, 200),
      departmentId: data.departmentId, departmentName: department.name,
      venueId: data.venueId, venueName: venue.name,
      startAt: o.startAt, endAt: o.endAt,
      status, visibility, requestedVisibility: visibility,
      dateBasis: recurrence.basis, hijriDate: o.hijriDate, timeMode: recurrence.timeMode,
      ...programFields(data),
      contactName: String(data.contactName).slice(0, 200),
      contactEmail: String(data.contactEmail).slice(0, 200),
      contactPhone: data.contactPhone ? String(data.contactPhone).slice(0, 50) : '',
      notes: data.notes ? String(data.notes).slice(0, 2000) : '',
      hasConflict: ids.length > 0, conflictWith: ids,
      seriesId, seriesIndex: o.index, seriesCount: occurrences.length, recurrence,
      createdByUid: admin.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
  });
  await commitInChunks(writes);
  const conflictChanges = occurrences.map((occurrence, index) => ({
    id: refs[index].id,
    after: {
      venueId: data.venueId,
      startAt: occurrence.startAt,
      endAt: occurrence.endAt,
      status,
      conflictWith: []
    }
  }));
  for (let offset = 0; offset < conflictChanges.length; offset += CONFLICT_REFRESH_BATCH_SIZE) {
    await refreshConflictNeighborhood(conflictChanges.slice(offset, offset + CONFLICT_REFRESH_BATCH_SIZE));
  }
  conflicts = (await db.getAll(...refs)).filter(doc => doc.exists && doc.data().hasConflict).length;
  await writeAudit({
    entityType: 'series', entityId: seriesId, action: 'series_created',
    userId: admin.uid, userEmail: admin.email,
    note: `Created ${occurrences.length} recurring occurrence(s) as ${status}; ${conflicts} flagged with a venue overlap.`,
    diff: { recurrence }
  });
  // Row 8: one summary email per series (not per occurrence), only when a contact email was entered.
  if (occurrences.length) {
    const first = { ...data, venueName: venue.name, departmentName: department.name, ...programFields(data), startAt: occurrences[0].startAt, endAt: occurrences[0].endAt, timeMode: recurrence.timeMode };
    const sHijri = hijriInfoFor(dateKeyOf(first.startAt), await getHijriOverrides());
    await sendAll([notify.seriesCreatedRequester(first, sHijri, { count: occurrences.length, lastStartAt: occurrences[occurrences.length - 1].startAt, status })]);
  }
  return { seriesId, created: occurrences.length, conflicts, status };
});

// â”€â”€ Callable: admin-only program extras (Niaz sponsor, reciters, volunteers, expenses) â”€â”€
// Stored on the event doc for one occurrence; never included in public projections.
exports.updateProgramExtras = onCall({ cors: true }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { eventId } = request.data || {};
  if (!eventId || typeof eventId !== 'string') throw new HttpsError('invalid-argument', 'eventId is required.');
  let patch;
  try { patch = sanitizeProgramExtras(request.data); } catch (e) { throw new HttpsError('invalid-argument', e.message); }
  if (!Object.keys(patch).length) throw new HttpsError('invalid-argument', 'Nothing to update.');
  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  await ref.update({ ...patch, updatedAt: new Date().toISOString() });
  const parts = [];
  if ('niazSponsor' in patch) parts.push(`Niaz sponsor: ${patch.niazSponsor ? patch.niazSponsor.name : 'none'}`);
  if ('reciters' in patch) parts.push(`${patch.reciters.length} reciter(s)`);
  if ('volunteers' in patch) parts.push(`${patch.volunteers.length} volunteer(s)`);
  if ('expenses' in patch) parts.push(`${patch.expenses.length} expense(s), total $${expensesTotal(patch.expenses).toFixed(2)}`);
  await writeAudit({
    entityType: 'event', entityId: eventId, action: 'program_extras_updated',
    userId: admin.uid, userEmail: admin.email, note: parts.join('; ')
  });
  return { ok: true, ...patch };
});

// â”€â”€ Callable: admin-only delete (single occurrence, this & future, or whole series) â”€â”€
exports.deleteBooking = onCall({ cors: true, secrets: emailSecrets }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { eventId } = request.data || {};
  const scope = normalizeScope((request.data || {}).scope);
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  const snap = await db.collection('events').doc(eventId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const anchor = { id: eventId, ...snap.data() };
  const nowIso = new Date().toISOString();

  // Past bookings are permanent records: they are never hard-deleted (cancel instead).
  let targets = [anchor];
  let kept = 0;
  if (scope !== 'single' && anchor.seriesId) {
    const seriesSnap = await db.collection('events').where('seriesId', '==', anchor.seriesId)
      .limit(MAX_SERIES_OCCURRENCES + 1).get();
    if (seriesSnap.size > MAX_SERIES_OCCURRENCES) {
      throw new HttpsError('resource-exhausted', 'This booking series is too large to delete safely in one request.');
    }
    const docs = seriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const all = selectSeriesTargets(docs, anchor, scope);
    targets = selectSeriesTargets(docs, anchor, scope, nowIso);
    kept = all.length - targets.length;
    if (!targets.length) throw new HttpsError('failed-precondition', 'All matching occurrences are in the past and are kept as records.');
  } else if (anchor.startAt <= nowIso) {
    throw new HttpsError('failed-precondition', 'Past bookings are kept as records and cannot be deleted. Cancel it instead.');
  }

  const writes = [];
  for (const t of targets) {
    writes.push((batch) => batch.delete(db.collection('events').doc(t.id)));
    writes.push((batch) => batch.set(db.collection('auditLog').doc(), {
      entityType: 'event', entityId: t.id, action: 'deleted',
      userId: admin.uid, userEmail: admin.email,
      note: `Deleted "${String(t.title || '').slice(0, 80)}" (${t.startAt}, was ${t.status})${anchor.seriesId ? `, series ${anchor.seriesId}, scope ${scope}` : ''}.`,
      diff: null, timestamp: new Date().toISOString()
    }));
  }
  await commitInChunks(writes, 400);
  const conflictChanges = targets.map(target => ({ id: target.id, before: target }));
  for (let offset = 0; offset < conflictChanges.length; offset += CONFLICT_REFRESH_BATCH_SIZE) {
    await refreshConflictNeighborhood(conflictChanges.slice(offset, offset + CONFLICT_REFRESH_BATCH_SIZE));
  }
  // Row 7: deleting confirmed bookings is treated like a cancellation; pending/decided-negative ones send nothing.
  const confirmedGone = targets.filter(t => t.status === 'confirmed').sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  if (confirmedGone.length) {
    const dHijri = hijriInfoFor(dateKeyOf(confirmedGone[0].startAt), await getHijriOverrides());
    await sendAll([notify.deletionRequester(confirmedGone[0], dHijri, confirmedGone.length)]);
  }
  return { deleted: targets.length, kept, scope };
});

// â”€â”€ Callable: live slot conflict check (public-safe) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Public callers get only { hasConflict, count }; admins also get the conflicting bookings.
exports.checkSlotConflicts = onCall({ cors: true }, async (request) => {
  const { venueId, startAt, endAt, excludeId } = request.data || {};
  if (!venueId || typeof venueId !== 'string' || !startAt || !endAt) {
    throw new HttpsError('invalid-argument', 'venueId, startAt and endAt are required.');
  }
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) throw new HttpsError('invalid-argument', 'Invalid time range.');
  const venueSnap = await db.collection('venues').doc(venueId).get();
  if (!venueSnap.exists) throw new HttpsError('not-found', 'Venue not found.');
  const isAdmin = await isSubmitterAdmin(request.auth);
  const overlaps = await findOverlaps(venueId, new Date(s).toISOString(), new Date(e).toISOString(), isAdmin ? excludeId : null, undefined, resolveBufferHours(venueSnap.data()));
  return buildConflictResponse(overlaps, isAdmin);
});

// â”€â”€ Callable: admin recompute of every stored conflict flag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.recomputeAllConflicts = onCall({ cors: true }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const venues = await db.collection('venues').get();
  const changed = await recomputeVenueConflicts(venues.docs.map(d => d.id));
  await writeAudit({ entityType: 'event', entityId: 'all', action: 'conflicts_recomputed', userId: admin.uid, userEmail: admin.email, note: `Recomputed conflicts for ${venues.size} venue(s); ${changed} booking(s) changed.` });
  return { venues: venues.size, changed };
});

// â”€â”€ Callable: admin Excel import (dryRun returns the validation report only) â”€â”€
exports.importBookings = onCall({ cors: true, timeoutSeconds: 120 }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { rows, dryRun } = request.data || {};
  if (!Array.isArray(rows)) throw new HttpsError('invalid-argument', 'rows must be an array.');
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpsError('invalid-argument', `Too many rows (max ${MAX_IMPORT_ROWS}).`);

  const [deptSnap, venueSnap] = await Promise.all([
    db.collection('departments').limit(MAX_IMPORT_ROWS + 1).get(),
    db.collection('venues').limit(MAX_IMPORT_ROWS + 1).get()
  ]);
  if (deptSnap.size > MAX_IMPORT_ROWS || venueSnap.size > MAX_IMPORT_ROWS) {
    throw new HttpsError('resource-exhausted', 'Too many booking types or venues to validate this import safely.');
  }
  const departments = deptSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const venues = venueSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const existingById = {};
  const ids = importIds(rows);
  if (ids.length) {
    const existing = await db.getAll(...ids.map(id => db.collection('events').doc(id)));
    existing.forEach(doc => { if (doc.exists) existingById[doc.id] = doc.data(); });
  }

  const hijriOverrides = await getHijriOverrides();
  const validationContext = { departments, venues, existingById, existingKeys: new Set(), hijriOverrides };
  const firstPass = validateImportRows(rows, validationContext);
  const candidates = new Map();
  for (const row of firstPass.rows) {
    if (row.action !== 'create') continue;
    const data = row.data;
    const key = `${data.venueId}|${data.startAt}|${data.endAt}|${data.title.trim().toLowerCase()}`;
    if (!candidates.has(key)) candidates.set(key, data);
  }
  let duplicateCandidatesRead = 0;
  for (const data of candidates.values()) {
    const remaining = MAX_IMPORT_DUPLICATE_CANDIDATES - duplicateCandidatesRead;
    const matching = await db.collection('events')
      .where('venueId', '==', data.venueId)
      .where('startAt', '==', data.startAt)
      .where('endAt', '==', data.endAt)
      .limit(Math.min(remaining + 1, MAX_IMPORT_ROWS + 1))
      .get();
    if (matching.size > remaining) {
      throw new HttpsError('resource-exhausted', 'Too many matching bookings to check this import safely.');
    }
    duplicateCandidatesRead += matching.size;
    matching.forEach(doc => {
      const event = doc.data();
      validationContext.existingKeys.add(
        `${event.venueId}|${event.startAt}|${event.endAt}|${String(event.title || '').trim().toLowerCase()}`
      );
    });
  }
  const report = validateImportRows(rows, validationContext);
  const summary = {
    errors: report.errors, counts: report.counts,
    rows: report.rows.map(r => ({ row: r.row, action: r.action, id: r.id || null, title: r.data.title, startAt: r.data.startAt, endAt: r.data.endAt, warnings: r.warnings }))
  };
  if (dryRun) return { dryRun: true, ...summary };
  if (report.errors.length) throw new HttpsError('failed-precondition', 'Fix the row errors before importing.');

  const writes = [];
  const conflictChanges = [];
  let created = 0; let updated = 0;
  for (const r of report.rows) {
    if (r.action === 'skip') continue;
    const ref = r.action === 'update' ? db.collection('events').doc(r.id) : db.collection('events').doc();
    const base = { ...r.data, venueId: r.data.venueId, updatedAt: FieldValue.serverTimestamp() };
    const before = r.action === 'update' ? existingById[r.id] : null;
    if (r.action === 'update') {
      updated += 1;
      writes.push((batch) => batch.set(ref, base, { merge: true }));
    } else {
      created += 1;
      writes.push((batch) => batch.set(ref, { ...base, hasConflict: false, conflictWith: [], createdByUid: admin.uid, createdAt: FieldValue.serverTimestamp() }));
    }
    conflictChanges.push({
      id: ref.id,
      before,
      after: {
        ...(before || {}),
        ...r.data,
        ...(r.action === 'create' ? { hasConflict: false, conflictWith: [] } : {})
      }
    });
    writes.push((batch) => batch.set(db.collection('auditLog').doc(), {
      entityType: 'event', entityId: ref.id, action: r.action === 'update' ? 'import_updated' : 'imported',
      userId: admin.uid, userEmail: admin.email,
      note: `Excel import row ${r.row}: ${String(r.data.title).slice(0, 80)}`, diff: null, timestamp: new Date().toISOString()
    }));
  }
  await completeImport({
    commit: () => commitInChunks(writes, 400),
    refresh: async () => {
      for (let offset = 0; offset < conflictChanges.length; offset += CONFLICT_REFRESH_BATCH_SIZE) {
        await refreshConflictNeighborhood(conflictChanges.slice(offset, offset + CONFLICT_REFRESH_BATCH_SIZE));
      }
    },
    audit: () => writeAudit({ entityType: 'event', entityId: 'import', action: 'import_summary', userId: admin.uid, userEmail: admin.email, note: `Excel import: ${created} created, ${updated} updated, ${report.counts.skip || 0} skipped.` }),
    logError: details => logger.error('Excel import did not complete', details)
  });
  return { dryRun: false, created, updated, skipped: report.counts.skip || 0, ...summary };
});

// ── Admin team access (Google sign-in + adminAllowlist) ──────────────────────
// adminAllowlist/{email} is the source of truth; users/{uid}.role mirrors it for firestore.rules.

/** Called by the client after every sign-in. Grants, migrates, revokes or denies admin access. */
exports.syncAdminAccess = onCall({ cors: true }, async (request) => {
  const auth = request.auth;
  if(auth){const viewer=await require('./responseViewer').resolveViewer(db,auth.uid,auth.token);if(viewer)return {admin:false,viewer:true};}
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const email = normalizeEmail(auth.token.email);
  const emailVerified = auth.token.email_verified === true;
  const provider = auth.token.firebase?.sign_in_provider || '';
  const userRef = db.collection('users').doc(auth.uid);
  const grantRef = email ? db.collection('adminAllowlist').doc(email) : null;
  const [userSnap, listSnap, passwordLoginDisabled] = await Promise.all([
    userRef.get(),
    grantRef ? grantRef.get() : Promise.resolve(null),
    isPasswordLoginDisabled()
  ]);
  const decision = decideSignIn({
    email,
    emailVerified,
    allowlisted: !!(listSnap && listSnap.exists),
    grantUid: listSnap?.data()?.uid,
    uid: auth.uid,
    userDoc: userSnap.exists ? userSnap.data() : null,
    provider,
    passwordLoginDisabled
  });
  const now = new Date().toISOString();
  const displayName = auth.token.name || '';

  if (decision.action === 'grant' || decision.action === 'migrate') {
    const listRef=db.collection('adminAllowlist').doc(email);
    await db.runTransaction(async tx=>{
      const [freshList,freshUser]=await Promise.all([tx.get(listRef),tx.get(userRef)]);
      const current=decideSignIn({email,emailVerified,provider,passwordLoginDisabled,allowlisted:freshList.exists,grantUid:freshList.data()?.uid,uid:auth.uid,userDoc:freshUser.exists?freshUser.data():null});
      if(!['grant','migrate'].includes(current.action))throw new HttpsError('permission-denied','Admin access was removed.');
      tx.set(userRef,{role:'admin',email,displayName,allowlistManaged:true,lastSignInAt:now,lastSignInProvider:provider},{merge:true});
      if(!freshList.exists)tx.create(listRef,{email,addedBy:current.owner?'account owner':'existing admin (migrated)',addedAt:now,uid:auth.uid,displayName,lastSignInAt:now});
      else tx.update(listRef,{uid:auth.uid,displayName,lastSignInAt:now});
    });
    await writeAudit({ entityType: 'admin', entityId: email, action: decision.action === 'migrate' ? 'admin.migrated' : 'admin.signin', userId: auth.uid, userEmail: email, note: `Signed in via ${provider || 'unknown'}` });
    if (!passwordLoginDisabled && shouldDisablePasswordLogin({ email, provider })) {
      await AUTH_SETTINGS_DOC().set({ passwordLoginDisabled: true, disabledAt: now, disabledBy: email }, { merge: true });
      await writeAudit({ entityType: 'admin', entityId: 'auth', action: 'admin.password_login_disabled', userId: auth.uid, userEmail: email, note: 'Owner signed in with Google; email/password admin sign-in turned off.' });
    }
    return { admin: true, owner: email === OWNER_EMAIL };
  }

  if (decision.action === 'revoke') {
    await userRef.set({ role: 'revoked', revokedAt: now }, { merge: true });
  }
  // A disabled password session is only refused, not revoked: the same uid may be linked to Google.
  await writeAudit({ entityType: 'admin', entityId: email || auth.uid, action: 'admin.signin_denied', userId: auth.uid, userEmail: email, note: decision.reason || decision.action });
  return { admin: false, reason: decision.reason || 'not-listed' };
});

exports.removeAdminEmail = onCall({ cors: true }, async (request) => {
  const admin = await requireAdmin(request.auth,'tools-automation');
  const email = normalizeEmail(request.data?.email);
  const listSnap = await db.collection('adminAllowlist').get();
  const listedEmails = listSnap.docs.map(d => d.id);
  const problem = checkRemoval({ target: email, requesterEmail: admin.email, listedEmails });
  if (problem) throw new HttpsError('failed-precondition', problem);

  const entry = listSnap.docs.find(d => d.id === email).data();
  const uids = new Set();
  if (entry.uid) uids.add(entry.uid);
  try { uids.add((await getAuth().getUserByEmail(email)).uid); } catch { /* no auth account yet */ }
  const byEmail = await db.collection('users').where('email', '==', email).get();
  byEmail.docs.forEach(d => uids.add(d.id));

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.delete(db.collection('adminAllowlist').doc(email));
  uids.forEach(uid => batch.set(db.collection('users').doc(uid), { role: 'revoked', allowlistManaged: true, revokedAt: now }, { merge: true }));
  await batch.commit();
  // Force existing sessions to re-authenticate so revocation is immediate everywhere.
  await Promise.all([...uids].map(uid => getAuth().revokeRefreshTokens(uid).catch(() => null)));
  await writeAudit({ entityType: 'admin', entityId: email, action: 'admin.removed', userId: admin.uid, userEmail: admin.email, note: `Removed ${email} from the admin list` });
  return { ok: true, email };
});

// â”€â”€ Callable: public read of sanitized events (confirmed in full if public; private & pending masked) â”€â”€
exports.getPublicEvents = onCall({ cors: true }, async (request) => {
  const { from, to, cursor: rawCursor } = request.data || {};
  const range = parseEventRange(from, to);
  let cursor = null;
  if (rawCursor) {
    try { cursor = publicQuery.decodeCursor(rawCursor); }
    catch (error) { throw new HttpsError('invalid-argument', error.message); }
  }
  const snap = await boundedEventQuery(
    db.collection('events').where('status', 'in', PUBLIC_STATUSES),
    range,
    cursor
  ).get();
  const page = pageData(snap);
  const overrides = await getHijriOverrides();
  const events = page.docs.map(d => sanitizePublicEvent(d.data(), d.id, overrides)).filter(Boolean);
  return { events, nextPageCursor: page.nextPageCursor };
});

exports.getAdminEvents = onCall({ cors: true }, async request => {
  await requireAdmin(request.auth, 'events-bookings');
  const input = request.data || {};
  if (input.allTime !== undefined && typeof input.allTime !== 'boolean') {
    throw new HttpsError('invalid-argument', 'The all-time option must be a boolean.');
  }
  if (input.allTime && (input.from !== undefined || input.to !== undefined)) {
    throw new HttpsError('invalid-argument', 'Do not combine all-time bookings with a date range.');
  }
  const allTime = input.allTime === true;
  const range = allTime ? null : parseEventRange(input.from, input.to);
  const adminBookingQuery = require('./adminBookingQuery');
  let cursor = null;
  if (input.cursor) {
    try { cursor = allTime ? adminBookingQuery.decodeBookingCursor(input.cursor) : publicQuery.decodeCursor(input.cursor); }
    catch (error) { throw new HttpsError('invalid-argument', error.message); }
  }
  const query = allTime
    ? adminBookingQuery.allBookingsPage(db.collection('events'), FieldPath.documentId(), cursor)
    : boundedAdminEventQuery(db.collection('events'), range, cursor);
  const snapshot = await query.get();
  const page = allTime ? adminBookingQuery.allBookingsPageData(snapshot) : pageData(snapshot);
  const overrides = await getHijriOverrides();
  return {
    events: page.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      ...(allTime ? { id: doc.id } : {}),
      hijri: hijriInfoFor(dateKeyOf(doc.data().startAt), overrides)
    })),
    nextPageCursor: page.nextPageCursor,
    ...(allTime ? { scope: 'all-time' } : {})
  };
});

// â”€â”€ Public iCal feed (confirmed + public only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.icalFeed = onRequest({ cors: true }, async (req, res) => {
  try {
    const range = publicQuery.defaultFeedRange();
    const events = [];
    let cursor = null;
    do {
      const snap = await boundedEventQuery(
        db.collection('events').where('status', 'in', PUBLIC_STATUSES),
        range,
        cursor
      ).get();
      const page = pageData(snap);
      events.push(...page.docs);
      if (events.length > publicQuery.MAX_RESULTS) {
        throw new HttpsError('resource-exhausted', 'The public calendar is too large to export safely.');
      }
      cursor = page.nextPageCursor ? publicQuery.decodeCursor(page.nextPageCursor) : null;
    } while (cursor);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MWA Central Calendar//EN', 'CALSCALE:GREGORIAN'];
    events.forEach(doc => {
      // Masked projection: private/pending items show only time + venue with a masked title.
      const e = projectPublicEvent(doc.data(), doc.id, null);
      if (!e) return;
      const sourceDoc = doc.data();
      lines.push(
        'BEGIN:VEVENT',
        // UID domain intentionally kept stable across the app rename â€” see
        // src/services/exportService.js for why (avoids breaking subscribers'
        // existing event dedup/update matching).
        `UID:${doc.id}@community-hub-calendar`,
        `DTSTAMP:${toIcsDate(sourceDoc.updatedAt || sourceDoc.createdAt || e.startAt)}`,
        `DTSTART:${toIcsDate(e.startAt)}`,
        `DTEND:${toIcsDate(e.endAt)}`,
        `SUMMARY:${icsEscape(e.title)}`,
        `LOCATION:${icsEscape(e.venueName || '')}`,
        `STATUS:${e.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(lines.join('\r\n'));
  } catch (err) {
    logger.error('icalFeed failed', { error: err.message });
    res.status(err instanceof HttpsError ? 503 : 500).send('Could not build the bounded calendar feed. Please retry later.');
  }
});

function pad(n) { return String(n).padStart(2, '0'); }
function toIcsDate(value) {
  const d = value && value.toDate ? value.toDate() : new Date(value);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}
function icsEscape(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// â”€â”€ Versioned REST API (/v1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Public read access mirrors getPublicEvents (sanitized, public+confirmed
// only). Writes and status changes require a Firebase ID token for an admin
// account (Authorization: Bearer <token>). This is an MVP surface â€” see
// docs/API.md for the documented contract and known limitations.
const app = express();
app.use(cors({ origin: true }));
app.use(jsonBody);

async function authenticateAdmin(req) {
  const header = req.get('Authorization') || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await getAuth().verifyIdToken(match[1],true);
    return await resolveAdmin(db,decoded.uid,decoded,'events-bookings');
  } catch {
    return null;
  }
}

app.get('/v1/events', async (req, res) => {
  try {
    const { from, to, venue, department, status, cursor: rawCursor } = req.query;
    const range = parseEventRange(from, to);
    let cursor = null;
    if (rawCursor) cursor = publicQuery.decodeCursor(rawCursor);
    const admin = await authenticateAdmin(req);
    let query = db.collection('events');
    if (!admin) {
      query = query.where('status', 'in', PUBLIC_STATUSES);
    } else if (status) {
      if (!STATUSES.includes(status)) throw new HttpsError('invalid-argument', 'Invalid status filter.');
      query = query.where('status', '==', status);
    }
    if (venue) query = query.where('venueId', '==', venue);
    if (department) query = query.where('departmentId', '==', department);
    const snapshot = await boundedEventQuery(query, range, cursor).get();
    const page = pageData(snapshot);
    const overrides = await getHijriOverrides();
    const events = page.docs.map(d => admin
      ? { id: d.id, ...d.data(), hijri: hijriInfoFor(dateKeyOf(d.data().startAt), overrides) }
      : sanitizePublicEvent(d.data(), d.id, overrides)).filter(Boolean);
    res.json({ events, nextPageCursor: page.nextPageCursor });
  } catch (error) {
    if (error instanceof HttpsError) return res.status(mapHttpsErrorCode(error.code)).json({ error: error.message });
    logger.error('GET /v1/events failed', { error: error.message });
    res.status(500).json({ error: 'Could not load events.' });
  }
});

app.post('/v1/events', async (req, res) => {
  try {
    const admin = await authenticateAdmin(req);
    let identity=null;
    const bearer=/^Bearer (.+)$/i.exec(req.headers.authorization||'');
    if(bearer){try{const token=await getAuth().verifyIdToken(bearer[1],true);if(require('./bookingIdentity').authenticatedBookingIdentity({uid:token.uid,token}))identity=token;}catch{throw new HttpsError('unauthenticated','Your sign-in expired. Sign in again.');}}
    if (!admin) await requireRestAppCheck(req);
    const result = await createBookingSubmission(req.body || {}, {
      isAdmin: !!admin,
      authenticated:!!identity,
      uid: admin?.uid || identity?.uid || null,
      email: admin?.email || identity?.email || ''
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof HttpsError) return res.status(mapHttpsErrorCode(err.code)).json({ error: err.message, conflictWith: [] });
    logger.error('POST /v1/events failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.patch('/v1/events/:id/status', async (req, res) => {
  const admin = await authenticateAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Admin bearer token required.' });
  const { status, visibility, note } = req.body || {};
  if (!STATUSES.includes(status) || status === 'pending') return res.status(400).json({ error: 'Invalid status.' });

  const ref = db.collection('events').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Not found' });
  const before = snap.data();

  let hasConflict = before.hasConflict, conflictWith = before.conflictWith || [];
  if (status === 'confirmed') {
    const overlaps = await findOverlaps(before.venueId, before.startAt, before.endAt, req.params.id);
    hasConflict = overlaps.length > 0; conflictWith = overlaps.map(o => o.id);
  }
  const patch = {
    status, hasConflict, conflictWith,
    decidedBy: admin.uid, decidedByEmail: admin.email, decidedAt: FieldValue.serverTimestamp(),
    decisionNote: note || '', updatedAt: FieldValue.serverTimestamp()
  };
  const explicitVisibility = sanitizeVisibility(visibility);
  if (explicitVisibility) patch.visibility = explicitVisibility;
  await ref.update(patch);
  await writeAudit({ entityType: 'event', entityId: req.params.id, action: `status_${status}`, userId: admin.uid, userEmail: admin.email, note });
  res.json({ id: req.params.id, status, hasConflict });
});

// Note: this reports raw (unbuffered) booked windows for day-level display, not the
// buffered conflict rule used by hasConflict/conflictWith above â€” see docs/API.md.
app.get('/v1/availability', async (req, res) => {
  const { venue, date } = req.query;
  if (!venue || !date) return res.status(400).json({ error: 'venue and date (YYYY-MM-DD) are required.' });
  let range;
  try { range = publicQuery.civilDayRange(date); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const snap = await db.collection('events')
    .where('venueId', '==', venue)
    .where('status', 'in', ACTIVE_FOR_CONFLICTS)
    .where('startAt', '<', range.to)
    .where('endAt', '>', range.from)
    .orderBy('startAt').orderBy('endAt')
    .orderBy(FieldPath.documentId())
    .limit(MAX_CONFLICT_CANDIDATES + 1)
    .get();
  if (snap.size > MAX_CONFLICT_CANDIDATES) {
    return res.status(503).json({ error: 'Too many bookings fall in this availability window. Please retry later.' });
  }
  const busy = snap.docs
    .map(d => d.data())
    .map(e => ({ start: e.startAt, end: e.endAt, status: e.status }));
  res.json({ venue, date, busy });
});

function mapHttpsErrorCode(code) {
  return { 'invalid-argument': 400, 'failed-precondition': 400, 'not-found': 404, 'permission-denied': 403, unauthenticated: 401 }[code] || 500;
}

exports.api = onRequest({ cors: true, secrets: [...emailSecrets, BOOKING_OTP_HMAC_KEY] }, app);

// â”€â”€ Trigger: re-resolve Hijri-sourced bookings after an admin moon-sighting
// adjustment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Gregorian-based bookings never move â€” their stored startAt/endAt is always
// the source of truth and only their *displayed* Hijri equivalent changes.
// Hijri-based bookings are fixed to their stored hijriDate {day, month, year};
// when the admin changes calendarSettings/hijri (a new/updated/removed
// moon-sighting override), every Hijri-sourced booking's resolved Gregorian
// startAt/endAt is recomputed here so its calendar placement, conflict
// detection and exports/API all reflect the new adjustment, without ever
// touching the booking's fixed Hijri day.
const {createHijriRecovery} = require('./hijriRecovery');
const hijriRecovery = createHijriRecovery({
  db, FieldValue, HttpsError, resolveBookingDates, dateKeyOf, hijriInfoFor, notify, sendMail,
  activeStatuses: ACTIVE_FOR_CONFLICTS, findOverlaps, resolveBufferHours,
  maxVenues: MAX_VENUES_FOR_CONFLICTS, auditEntry: require('./auditModel').auditEntry, logger
});
exports.onHijriSettingsChanged = onDocumentWritten({ document: 'calendarSettings/hijri', secrets: emailSecrets, retry: true, timeoutSeconds: 540 }, async event => {
  const deadline = Date.now() + 7 * 60 * 1000;
  await hijriRecovery.handleSettingsEvent(event, { deadline });
});
exports.retryHijriRecovery = onSchedule({ schedule: 'every 5 minutes', timeoutSeconds: 540, secrets: emailSecrets }, () => hijriRecovery.sweep());
exports.getHijriRecoveryStatus = onCall({ cors: true }, async request => {
  await requireAdmin(request.auth, 'calendar-management');
  return hijriRecovery.status();
});
exports.resolveHijriNotificationReview = onCall({ cors: true }, async request => {
  const admin = await requireAdmin(request.auth, 'calendar-management');
  await hijriRecovery.resolveReview(request.data?.id, admin);
  return { ok: true };
});

// ── Scheduled: reminder 2 days before each confirmed booking (row 12) ──
// Runs daily at 9 am Sydney; reminderSentFor guards against duplicates (it records the date reminded for,
// so a booking that is later moved gets a fresh reminder).
exports.sendBookingReminders = onSchedule({ schedule: '0 9 * * *', timeZone: 'Australia/Sydney', secrets: emailSecrets }, async () => {
  const target = notify.sydneyDateKey(new Date(), 2);
  const from = new Date(Date.now() + 86400000).toISOString();
  const to = new Date(Date.now() + 4 * 86400000).toISOString();
  const snap = await db.collection('events').where('startAt', '>=', from).where('startAt', '<', to).get();
  const overrides = await getHijriOverrides();
  let sent = 0;
  for (const doc of snap.docs) {
    const e = doc.data();
    const key = dateKeyOf(e.startAt);
    if (e.status !== 'confirmed' || key !== target || !e.contactEmail || e.reminderSentFor === key) continue;
    const [res] = await sendAll([notify.reminderRequester(e, hijriInfoFor(key, overrides))]);
    if (res && res.sent) { await doc.ref.update({ reminderSentFor: key }); sent += 1; }
  }
  logger.info('[email] reminders', { target, candidates: snap.size, sent });
});

// ── Scheduled: 8 am Sydney digest of pending requests to the admin inbox (row 13) ──
exports.sendPendingDigest = onSchedule({ schedule: '0 8 * * *', timeZone: 'Australia/Sydney', secrets: emailSecrets }, async () => {
  const snap = await db.collection('events').where('status', '==', 'pending').get();
  const pending = snap.docs.map(d => d.data());
  if (!pending.length) return;
  await sendAll([notify.pendingDigestAdmin(pending)]);
});

// Venue edits (buffer hours, whole-site flag) change who conflicts with whom: refresh stored flags.
exports.onVenueChanged = onDocumentWritten({ document: 'venues/{venueId}', region: 'australia-southeast1' }, async () => {
  await recomputeVenueConflicts();
});

// Shared administration endpoints: permissions and audit identity are verified server-side.
Object.assign(exports,require('./auditedAdmin').register({db,onCall,HttpsError,requireAdmin,FieldValue}));

Object.assign(exports,require('./teamPermissions').register({db,onCall,HttpsError,requireAdmin}));

Object.assign(exports,require('./bookingEmailDecision').register({db,onCall,HttpsError,requireAdmin,FieldValue,emailSecrets,findOverlaps,recomputeVenueConflicts,refreshConflictNeighborhood,sendAll,notify,getHijriOverrides,hijriInfoFor,dateKeyOf,logger}));

Object.assign(exports,require('./emailBookingLink').register({db,onRequest,FieldValue,emailSecrets,findOverlaps,recomputeVenueConflicts,refreshConflictNeighborhood,sendAll,notify,getHijriOverrides,hijriInfoFor,dateKeyOf,logger}));

const bookingOutbox=require('./bookingOutbox');
async function deliverSubmission(id){return bookingOutbox.deliver(db,id,async(job)=>{
 const event=(await db.doc('events/'+id).get()).data();if(!event)return [];
 const hijri=hijriInfoFor(dateKeyOf(event.startAt),await getHijriOverrides());
 const actions=job.submitterIsAdmin||event.status!=='pending'?null:await require('./emailBookingLink').issueLink(db,id,event);
 return [job.submitterIsAdmin&&event.status==='confirmed'?notify.decisionRequester(event,hijri,'confirmed','Created by an authorised admin.'):notify.submissionRequester(event,hijri),job.submitterIsAdmin?null:notify.submissionAdmin({...event,id,emailActions:actions},hijri,job.overlapDetails||[])].filter(Boolean);
},require('./mailer').sendMail);}
exports.bookingSubmissionDelivery=onDocumentWritten({document:'_bookingSubmissionJobs/{id}',secrets:emailSecrets},event=>deliverSubmission(event.params.id));
exports.bookingSubmissionRetry=onSchedule({schedule:'every 5 minutes',secrets:emailSecrets},async()=>{
 const jobs=await db.collection('_bookingSubmissionJobs').where('state','==','pending').where('nextAttempt','<=',Date.now()).orderBy('nextAttempt').limit(30).get();
 for(const job of jobs.docs)await deliverSubmission(job.id);
});
