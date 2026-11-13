function createBookingSubmissionService(deps) {
  const {
    db, FieldValue, Timestamp, HttpsError, bookingVerification,
    prepareBookingPayload, findOverlaps, resolveBufferHours, refreshConflictNeighborhood,
    issueLink, sendAll, notify, hijriInfoFor, dateKeyOf, logger
  } = deps;

  return async function createBookingSubmission(data, caller) {
    const { isAdmin: submitterIsAdmin, uid, email } = caller;
    const initialStatus=submitterIsAdmin?'confirmed':'pending';
    const needsVerification = !submitterIsAdmin && !caller.authenticated;
    const { prepared: originalPayload, venue, department, overrides } =
      await prepareBookingPayload(data, submitterIsAdmin);
    const challengeId = needsVerification ? data.verificationChallengeId : null;
    const requestSessionHash = needsVerification ? deps.sessionHash(data.verificationSessionId) : null;
    if (needsVerification && (typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(challengeId))) {
      throw new HttpsError('failed-precondition', 'Verify your selected contact before submitting the booking.');
    }
    const challengeRef = challengeId ? db.collection('_bookingVerificationChallenges').doc(challengeId) : null;
    const idempotencyRef = challengeId ? db.collection('_bookingSubmissionKeys').doc(challengeId) : null;
    const eventRef = db.collection('events').doc();
    const visibility = submitterIsAdmin
      ? (deps.sanitizeVisibility(originalPayload.visibility) || 'private')
      : (deps.sanitizeVisibility(originalPayload.visibility) || 'public');
    let result;

    await db.runTransaction(async tx => {
      if (idempotencyRef) {
        const existing = await tx.get(idempotencyRef);
        if (existing.exists) {
          const saved = existing.data();
          if (!bookingVerification.canReplay(saved, {
            sessionIdHash: requestSessionHash,
            payload: originalPayload
          })) {
            throw new HttpsError('failed-precondition', 'Booking details changed after verification. Verify the selected contact again.');
          }
          result = { id: saved.eventId, hasConflict: saved.hasConflict, status: 'pending', replayed: true };
          return;
        }
      }

      let payload = originalPayload;
      let contactVerification = null;
      if (challengeRef) {
        const challengeSnapshot = await tx.get(challengeRef);
        const challenge = challengeSnapshot.exists ? challengeSnapshot.data() : null;
        if (!challenge || challenge.purpose !== 'public-booking' || challenge.sessionIdHash !== requestSessionHash) {
          throw new HttpsError('failed-precondition', 'Verify your selected contact again before submitting the booking.');
        }
        let contact;
        try { contact = bookingVerification.selectedContact(challenge.method, originalPayload); }
        catch { throw new HttpsError('failed-precondition', 'The selected contact changed. Verify it again before submitting.'); }
        if (challenge.method === 'mobile') payload = { ...originalPayload, contactPhone: contact };
        if (!bookingVerification.isVerifiedChallenge(challenge, {
          method: challenge.method,
          contact,
          payload,
          sessionIdHash: requestSessionHash
        })) {
          throw new HttpsError('failed-precondition', 'Booking details or selected contact changed after verification. Verify again.');
        }
        contactVerification = { method: challenge.method, contact, verifiedAt: challenge.verifiedAt };
      }

      const overlaps = await findOverlaps(
        payload.venueId, payload.startAt, payload.endAt, null, tx, resolveBufferHours(venue), undefined, payload.audience
      );
      if(submitterIsAdmin&&overlaps.length)throw new HttpsError('failed-precondition','This venue has an overlapping booking. Resolve the clash before confirming an admin booking.');
      const conflictWith = overlaps.map(overlap => overlap.id);
      const savedBooking = {
        ...payload,
        departmentName: department.name,
        venueName: venue.name,
        status: initialStatus,
        visibility,
        requestedVisibility: visibility,
        hasConflict: overlaps.length > 0,
        conflictWith,
        createdByUid: uid || null,
        contactVerification: contactVerification
          ? { method: contactVerification.method, contact: contactVerification.contact, verifiedAt: contactVerification.verifiedAt }
          : null,
        contactEmailVerified: contactVerification?.method === 'email',
        contactPhoneVerified: contactVerification?.method === 'mobile',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };
      if (challengeRef) tx.update(challengeRef, { status: 'consumed', consumedAt: FieldValue.serverTimestamp() });
      tx.create(eventRef, savedBooking);
      if(deps.deliverSubmission)tx.create(db.collection('_bookingSubmissionJobs').doc(eventRef.id),{state:'pending',nextAttempt:Date.now(),submitterIsAdmin,delivery:{},createdAt:FieldValue.serverTimestamp()});
      if (idempotencyRef) {
        tx.create(idempotencyRef, {
          eventId: eventRef.id,
          sessionIdHash: requestSessionHash,
          payloadDigest: bookingVerification.payloadDigest(originalPayload),
          hasConflict: overlaps.length > 0,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
      }
      tx.create(db.collection('auditLog').doc(), deps.auditEntry({
        entityType: 'event',
        entityId: eventRef.id,
        action: 'submitted',
        userId: uid || null,
        userEmail: uid ? email : originalPayload.contactEmail,
        note: submitterIsAdmin?'Created and confirmed by an authorised admin.':overlaps.length ? 'Submitted as pending with a detected venue overlap.' : 'Submitted as pending.'
      }));
      result = { id: eventRef.id, hasConflict: overlaps.length > 0, status: initialStatus, replayed: false };
    });

    if (result.replayed) return result;
    const saved = (await db.collection('events').doc(result.id).get()).data() || {};
    await refreshConflictNeighborhood([{ id: result.id, after: saved }]).catch(error => {
      logger.error('Booking conflict refresh failed after submission', { eventId: result.id, error });
    });
    if(deps.deliverSubmission){await deps.deliverSubmission(result.id).catch(error=>logger.error('Booking delivery queued',{eventId:result.id}));return {id:result.id,hasConflict:result.hasConflict,status:result.status};}
    const hijri = hijriInfoFor(dateKeyOf(saved.startAt), overrides);
    const emailActions = submitterIsAdmin ? null : await issueLink(db, result.id, saved);
    await sendAll([
      submitterIsAdmin?notify.decisionRequester(saved,hijri,'confirmed','Created by an authorised admin.'):notify.submissionRequester(saved, hijri),
      submitterIsAdmin ? null : notify.submissionAdmin({ ...saved, id: result.id, emailActions }, hijri, [])
    ]);
    return { id: result.id, hasConflict: result.hasConflict, status: result.status };
  };
}

module.exports = { createBookingSubmissionService };
