'use strict';

const { createHash } = require('node:crypto');
const { validatePair, mergedTitle, selectedItems } = require('./eventMergePolicy');
const { OWNER_EMAIL } = require('./adminAccess');
const MAX_LINKS = 320;
const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const stamp = () => new Date().toISOString();

function fail(code, message, HttpsError) { throw new HttpsError(code, message); }
function mergeKey(sponsorId, eventId, origin) { return hash([sponsorId, eventId, origin || 'coordinator'].join(':')); }
function associationKey(sponsorId, eventId) { return mergeKey(sponsorId, eventId, 'sandbox-donation'); }

async function inventory(db, read, keepId, removeId, HttpsError) {
  if (!id(keepId) || !id(removeId) || keepId === removeId) fail('invalid-argument', 'Choose two different events.', HttpsError);
  const keepRef = db.doc(`events/${keepId}`), removeRef = db.doc(`events/${removeId}`);
  const [keepSnap, removeSnap] = await Promise.all([read(keepRef), read(removeRef)]);
  if (!keepSnap.exists || !removeSnap.exists) fail('not-found', 'One of the selected events is no longer available.', HttpsError);
  const keep = { id: keepId, ...keepSnap.data() }, remove = { id: removeId, ...removeSnap.data() };
  for (const kind of ['volunteers', 'reciters', 'expenses']) {
    if (!Array.isArray(keep[kind])) keep[kind] = [];
    if (!Array.isArray(remove[kind])) remove[kind] = [];
  }
  try { validatePair(keep, remove); } catch (error) { fail('failed-precondition', error.message, HttpsError); }
  if (Array.isArray(remove.mergedFrom) && remove.mergedFrom.length) fail('failed-precondition', 'Keep the already combined booking record when merging another programme.', HttpsError);
  if (keep.mergeLock || remove.mergeLock) fail('failed-precondition', 'An event merge is already in progress. Refresh the list.', HttpsError);

  const query = (collection, field, value, operator = '==') => db.collection(collection).where(field, operator, value).limit(MAX_LINKS + 1);
  const group = (collection, field, value) => db.collectionGroup(collection).where(field, '==', value).limit(MAX_LINKS + 1);
  const specs = [
    ['sponsorships', query('niazSponsorships', 'eventId', keepId), query('niazSponsorships', 'eventId', removeId)],
    ['eois', query('niazEOIs', 'eventIds', keepId, 'array-contains'), query('niazEOIs', 'eventIds', removeId, 'array-contains')],
    ['donations', query('_stripeSandboxDonations', 'niaz.eventId', keepId), query('_stripeSandboxDonations', 'niaz.eventId', removeId)],
    ['ledgers', query('_niazSandboxLedger', 'eventId', keepId), query('_niazSandboxLedger', 'eventId', removeId)],
    ['associations', query('_niazSandboxAssociations', 'eventId', keepId), query('_niazSandboxAssociations', 'eventId', removeId)],
    ['forms', query('registrationForms', 'eventId', keepId), query('registrationForms', 'eventId', removeId)],
    ['responses', group('responses', 'eventId', keepId), group('responses', 'eventId', removeId)],
    ['indexes', query('_registrationInsights', 'eventId', keepId), query('_registrationInsights', 'eventId', removeId)],
    ['viewers', query('_responseViewers', 'eventId', keepId), query('_responseViewers', 'eventId', removeId)],
    ['outbox', query('_niazOutbox', 'eventId', keepId), query('_niazOutbox', 'eventId', removeId)]
  ];
  const rows = {};
  for (const [name, ...queries] of specs) {
    const snapshots = await Promise.all(queries.map(read));
    if (snapshots.some(snapshot => snapshot.size > MAX_LINKS)) fail('resource-exhausted', `The ${name} history is too large for an atomic merge. No records were changed.`, HttpsError);
    rows[name] = [...new Map(snapshots.flatMap(snapshot => snapshot.docs).map(doc => [doc.ref.path, doc])).values()];
  }
  const coverage = await Promise.all([read(db.doc(`niazEventCoverage/${keepId}`)), read(db.doc(`niazEventCoverage/${removeId}`))]);
  const docs = [keepSnap, removeSnap, ...coverage, ...Object.values(rows).flat()];
  if (docs.length > MAX_LINKS) fail('resource-exhausted', 'This merge exceeds the safe transaction size. No records were changed.', HttpsError);
  const version = hash(docs.map(doc => `${doc.ref.path}:${doc.exists ? doc.updateTime?.toMillis?.() || JSON.stringify(doc.data()) : 'missing'}`).sort().join('|'));
  return { keep, remove, keepRef, removeRef, rows, coverage, version, count: docs.length };
}

function requireAccess(actor, inv, HttpsError) {
  const modules = new Set(actor.modules || []);
  const required = [
    ['niaz', ['sponsorships', 'eois', 'ledgers', 'associations', 'outbox']],
    ['donations', ['donations']],
    ['form-builder', ['forms', 'responses', 'indexes', 'viewers']]
  ];
  for (const [module, kinds] of required) if (!modules.has(module) && (kinds.some(kind => inv.rows[kind].length) || module === 'niaz' && inv.coverage.some(doc => doc.exists))) {
    fail('permission-denied', `Access to ${module} is required to merge these linked records.`, HttpsError);
  }
  if (!modules.has('niaz-finance') && (inv.rows.ledgers.length || inv.rows.associations.length || inv.coverage.some(doc => doc.data()?.targetCents != null || doc.data()?.confirmedCents != null))) {
    fail('permission-denied', 'Niaz finance access is required to merge linked contribution and coverage records.', HttpsError);
  }
  if (inv.rows.viewers.length && actor.email !== OWNER_EMAIL) fail('permission-denied', 'Super Admin must review the event response viewer grants before merging.', HttpsError);
}

async function preview(db, actor, keepId, removeId, HttpsError) {
  const inv = await inventory(db, ref => ref.get(), keepId, removeId, HttpsError);
  requireAccess(actor, inv, HttpsError);
  const sponsorIds = [...new Set(inv.rows.sponsorships.map(doc => doc.data().sponsorId).filter(id))];
  const sponsorDocs = sponsorIds.length ? await db.getAll(...sponsorIds.map(id => db.doc(`niazSponsors/${id}`))) : [];
  const names = new Map(sponsorDocs.map(doc => [doc.id, doc.data()?.name || 'Sponsor unavailable']));
  const source = doc => (doc.data().eventId || doc.data().niaz?.eventId) === keepId ? 'keep' : 'remove';
  return {
    version: inv.version,
    keep: inv.keep,
    remove: inv.remove,
    sponsorships: inv.rows.sponsorships.map(doc => ({ id: doc.id, source: source(doc), sponsorId: doc.data().sponsorId, name: names.get(doc.data().sponsorId), type: doc.data().type, role: doc.data().role, status: doc.data().status })),
    donations: inv.rows.donations.map(doc => ({ id: doc.id, source: source(doc), name: doc.data().name || '', amount: doc.data().amount || 0, status: doc.data().status, date: doc.data().niaz?.date || '' })),
    counts: Object.fromEntries(Object.entries(inv.rows).map(([kind, docs]) => [kind, docs.length])),
    coverage: inv.coverage.map(doc => ({ source: doc.id === keepId ? 'keep' : 'remove', exists: doc.exists, arrangementConfirmed: doc.data()?.arrangementConfirmed === true, mwaArranged: doc.data()?.mwaArranged === true,
      acceptExtraEOIs: doc.data()?.acceptExtraEOIs === true, notes: doc.data()?.notes || '', targetCents: doc.data()?.targetCents ?? null, fundsRequiredCents: doc.data()?.fundsRequiredCents ?? null })),
    warnings: [inv.keep.seriesId !== inv.remove.seriesId ? 'The annual programme series remain separate after this occurrence is merged.' : null, inv.rows.eois.length ? 'Pending sponsorship requests will move to the retained event for coordinator review.' : null].filter(Boolean)
  };
}

function normalizeExtras(inv, input, HttpsError) {
  const chosen = {};
  for (const kind of ['volunteers', 'reciters', 'expenses']) {
    try { chosen[kind] = selectedItems(inv.keep[kind], inv.remove[kind], input?.[kind], kind).map((item, index) => ({ ...item, id: `merged_${hash(`${kind}:${item.id}:${index}`).slice(0,16)}` })); }
    catch (error) { fail('invalid-argument', error.message, HttpsError); }
    if (chosen[kind].length > 50) fail('invalid-argument', `Select no more than 50 ${kind}.`, HttpsError);
  }
  try {
    const safe = require('./programExtras').sanitizeProgramExtras(chosen);
    if (['volunteers', 'reciters', 'expenses'].some(kind => safe[kind].length !== chosen[kind].length)) fail('invalid-argument', 'A programme item is incomplete. Review it before merging.', HttpsError);
    return safe;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    fail('invalid-argument', error.message, HttpsError);
  }
}

function decisions(inv, input, HttpsError) {
  if (!input || input.version !== inv.version) fail('failed-precondition', 'Linked records changed. Refresh the merge review.', HttpsError);
  let title;
  try { title = mergedTitle(input.title); } catch (error) { fail('invalid-argument', error.message, HttpsError); }
  const extras = normalizeExtras(inv, input.extras, HttpsError);
  const sponsorIds = input.sponsorIds, donationIds = input.donationIds;
  for (const [values, docs, label] of [[sponsorIds, inv.rows.sponsorships, 'sponsors'], [donationIds, inv.rows.donations, 'donations']]) {
    if (!Array.isArray(values) || values.length > MAX_LINKS || values.some(id => typeof id !== 'string') || new Set(values).size !== values.length || values.some(id => !docs.some(doc => doc.id === id))) fail('invalid-argument', `Review the ${label} selection.`, HttpsError);
  }
  if (!['keep', 'remove', 'clear'].includes(input.coverageSource)) fail('invalid-argument', 'Choose the Niaz coverage to retain.', HttpsError);
  const fields = input.fields || {};
  const startAt = fields.startAt || inv.keep.startAt, endAt = fields.endAt || inv.keep.endAt;
  if (typeof startAt !== 'string' || typeof endAt !== 'string') fail('invalid-argument', 'Choose valid programme start and end times.', HttpsError);
  const start = Date.parse(startAt), end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000 || start >= Date.parse(inv.keep.endAt) || end <= Date.parse(inv.keep.startAt) || start >= Date.parse(inv.remove.endAt) || end <= Date.parse(inv.remove.startAt)) fail('invalid-argument', 'The combined time must overlap both original programmes and be no longer than one day.', HttpsError);
  const speakerName = typeof fields.speakerName === 'string' ? fields.speakerName.trim() : inv.keep.speakerName || '';
  const programDetails = typeof fields.programDetails === 'string' ? fields.programDetails.trim() : inv.keep.programDetails || '';
  if (speakerName.length > 160 || programDetails.length > 4000) fail('invalid-argument', 'Programme details are too long.', HttpsError);
  const audience = fields.audience || inv.keep.audience;
  if (!['family', 'gents', 'ladies', 'kids'].includes(audience)) fail('invalid-argument', 'Choose a valid audience.', HttpsError);
  if (typeof input.confirmDelete !== 'boolean' || !input.confirmDelete) fail('invalid-argument', 'Confirm removal of the superseded booking and discarded operational entries.', HttpsError);
  return { title, extras, sponsorIds: new Set(sponsorIds), donationIds: new Set(donationIds), coverageSource: input.coverageSource, startAt, endAt, speakerName, programDetails, audience };
}

async function execute(db, actor, input, HttpsError, { findOverlaps, refreshConflicts, dateKey, logError }) {
  const result = await db.runTransaction(async tx => {
    const inv = await inventory(db, ref => tx.get(ref), input.keepId, input.removeId, HttpsError);
    requireAccess(actor, inv, HttpsError);
    const choice = decisions(inv, input, HttpsError);
    if (dateKey(choice.startAt) !== dateKey(inv.keep.startAt) || dateKey(choice.startAt) !== dateKey(inv.remove.startAt)) fail('invalid-argument', 'Keep the combined programme on the original local calendar day.', HttpsError);
    const unsettled = inv.rows.donations.filter(doc => ['awaiting_payment', 'awaiting_setup', 'setup_authorised'].includes(doc.data().status) || doc.data().fulfillmentPending === true);
    if (unsettled.length) fail('failed-precondition', 'A linked donation is still being processed. Complete or cancel it before merging.', HttpsError);
    const thirdParty = (await findOverlaps(inv.keep.venueId, choice.startAt, choice.endAt, inv.keep.id, tx, undefined, undefined, choice.audience)).filter(row => row.id !== inv.remove.id);
    if (thirdParty.length) fail('failed-precondition', 'The combined programme conflicts with another booking. Adjust its time or venue before merging.', HttpsError);
    const selectedSponsors = inv.rows.sponsorships.filter(doc => choice.sponsorIds.has(doc.id));
    const duplicateSponsors = new Set();
    for (const doc of selectedSponsors) {
      const sponsorId = doc.data().sponsorId;
      if (duplicateSponsors.has(sponsorId)) fail('invalid-argument', 'Choose only one assignment for each sponsor.', HttpsError);
      duplicateSponsors.add(sponsorId);
    }
    const selectedDonations = new Set(choice.donationIds);
    const donationById = new Map(inv.rows.donations.map(doc => [doc.id, doc]));
    for (const doc of inv.rows.ledgers) if (!donationById.has(doc.data().entry?.transactionId)) fail('failed-precondition', 'Niaz contribution history needs reconciliation before this merge.', HttpsError);
    const plannedWrites = 8 + Object.values(inv.rows).reduce((n, docs) => n + docs.length * 2, 0) + new Set(inv.rows.ledgers.map(doc => doc.data().sponsorId)).size;
    if (plannedWrites > 450) fail('resource-exhausted', 'This merge exceeds the safe atomic write limit. No records were changed.', HttpsError);
    const at = stamp(), mergeId = hash(`${inv.keep.id}:${inv.remove.id}:${inv.version}`).slice(0,32);
    const saved = { ...inv.keep, title: choice.title, startAt: choice.startAt, endAt: choice.endAt, speakerName: choice.speakerName, programDetails: choice.programDetails, audience: choice.audience,
      ...choice.extras, status: 'confirmed', visibility: 'public', mergedFrom: [...new Set([...(Array.isArray(inv.keep.mergedFrom) ? inv.keep.mergedFrom : []), inv.remove.id])], mergeOperationId: mergeId, mergeAt: at, mergeBy: actor.uid, updatedAt: at };
    delete saved.id;
    tx.set(inv.keepRef, saved);
    tx.delete(inv.removeRef);
    const sponsorshipPaths = new Set(inv.rows.sponsorships.map(doc => doc.ref.path));
    const transferPaths = new Set(selectedSponsors.filter(doc => doc.data().eventId === inv.remove.id).map(doc => db.doc(`niazSponsorships/${mergeKey(doc.data().sponsorId, inv.keep.id, doc.data().origin)}`).path));
    for (const doc of inv.rows.sponsorships) if (!choice.sponsorIds.has(doc.id) && !transferPaths.has(doc.ref.path)) tx.delete(doc.ref);
    for (const doc of selectedSponsors) {
      if (doc.data().eventId === inv.keep.id) continue;
      const newId = mergeKey(doc.data().sponsorId, inv.keep.id, doc.data().origin);
      const target = db.doc(`niazSponsorships/${newId}`);
      const value = { ...doc.data(), eventId: inv.keep.id, role: selectedSponsors.length > 1 ? 'joint' : doc.data().role, mergeOperationId: mergeId, updatedAt: at, revision: (doc.data().revision || 0) + 1 };
      if (sponsorshipPaths.has(target.path)) tx.set(target, value);
      else tx.create(target, value);
      tx.delete(doc.ref);
    }
    for (const doc of inv.rows.eois) {
      const value = doc.data();
      const eventIds = [...new Set((value.eventIds || []).map(id => id === inv.remove.id ? inv.keep.id : id))];
      const events = [...new Map((value.events || []).slice().sort((a, b) => (b.eventId === inv.remove.id) - (a.eventId === inv.remove.id)).map(item => [item.eventId === inv.remove.id ? inv.keep.id : item.eventId, { ...item, eventId: item.eventId === inv.remove.id ? inv.keep.id : item.eventId }])).values()];
      const alternatives = (value.alternatives || []).map(item => item.eventId === inv.remove.id ? { ...item, eventId: inv.keep.id } : item);
      tx.update(doc.ref, { eventIds, events, alternatives, mergeReviewRequired: true, revision: (value.revision || 0) + 1, updatedAt: at });
    }
    const [keepCoverage, removeCoverage] = inv.coverage;
    const coverageSource = choice.coverageSource === 'keep' ? keepCoverage : choice.coverageSource === 'remove' ? removeCoverage : null;
    if (choice.coverageSource === 'clear' || !coverageSource?.exists) { if (keepCoverage.exists) tx.delete(keepCoverage.ref); }
    else tx.set(keepCoverage.ref, { ...coverageSource.data(), eventReviewRequired: true, arrangementConfirmed: false, updatedAt: at, revision: (coverageSource.data().revision || 0) + 1 });
    if (removeCoverage.exists) tx.delete(removeCoverage.ref);
    for (const doc of inv.rows.donations) {
      const original = doc.data().niaz;
      const transfer = selectedDonations.has(doc.id);
      tx.update(doc.ref, { niaz: transfer ? { ...original, eventId: inv.keep.id, date: dateKey(choice.startAt), title: choice.title, startAt: choice.startAt } : { scope: 'historical_event', originalEventId: original.eventId, originalDate: original.date, originalTitle: original.title || '', allocationStatus: 'unallocated' },
        niazOriginalDesignation: doc.data().niazOriginalDesignation || original, mergeOperationId: mergeId, mergeAt: at });
    }
    const totals = new Map();
    for (const doc of inv.rows.ledgers) {
      if (!selectedDonations.has(doc.data().entry.transactionId)) { tx.delete(doc.ref); continue; }
      const value = doc.data(), entry = { ...value.entry, eventId: inv.keep.id };
      tx.update(doc.ref, { eventId: inv.keep.id, entry, mergeOperationId: mergeId, updatedAt: at });
      totals.set(value.sponsorId, (totals.get(value.sponsorId) || 0) + entry.netCents);
    }
    const associationPaths = new Set([...totals.keys()].map(sponsorId => db.doc(`_niazSandboxAssociations/${associationKey(sponsorId, inv.keep.id)}`).path));
    for (const doc of inv.rows.associations) if (!associationPaths.has(doc.ref.path)) tx.delete(doc.ref);
    for (const [sponsorId, netCents] of totals) {
      const ref = db.doc(`_niazSandboxAssociations/${associationKey(sponsorId, inv.keep.id)}`);
      tx.set(ref, { sponsorId, eventId: inv.keep.id, origin: 'event_donation', sandbox: true, netCents, status: netCents ? 'confirmed-test' : 'reversed-test', mergeOperationId: mergeId, updatedAt: at });
    }
    for (const doc of inv.rows.forms) tx.update(doc.ref, { eventId: inv.keep.id, revision: (doc.data().revision || 0) + 1, updatedAt: at });
    for (const doc of inv.rows.responses) if (doc.data().eventId === inv.remove.id) tx.update(doc.ref, { eventId: inv.keep.id, mergedFromEventId: inv.remove.id });
    for (const doc of inv.rows.indexes) if (doc.data().eventId === inv.remove.id) tx.update(doc.ref, { eventId: inv.keep.id });
    for (const doc of inv.rows.viewers) if (doc.data().eventId === inv.remove.id) tx.update(doc.ref, { eventId: inv.keep.id, revision: (doc.data().revision || 0) + 1 });
    for (const doc of inv.rows.outbox) tx.update(doc.ref, { eventId: inv.keep.id, originalEventId: doc.data().originalEventId || doc.data().eventId,
      ...(doc.data().state === 'pending' ? { state: 'attention', lastError: 'Programme merged; coordinator review required.' } : {}), mergeOperationId: mergeId, updatedAt: at });
    tx.create(db.collection('auditLog').doc(), { module: 'events-bookings', entityType: 'event', entityId: inv.keep.id, action: 'events_merged', userId: actor.uid, userEmail: actor.email, timestamp: at,
      diff: { mergeId, keptId: inv.keep.id, removedId: inv.remove.id, title: choice.title, selectedSponsorIds: [...choice.sponsorIds], discardedSponsorIds: inv.rows.sponsorships.filter(doc => !choice.sponsorIds.has(doc.id)).map(doc => doc.id),
        transferredDonationIds: [...choice.donationIds], unallocatedDonationIds: inv.rows.donations.filter(doc => !choice.donationIds.has(doc.id)).map(doc => doc.id),
        selectedExtraIds: input.extras, coverageSource: choice.coverageSource, counts: Object.fromEntries(Object.entries(inv.rows).map(([kind, docs]) => [kind, docs.length])) } });
    tx.set(db.doc(`_eventMerges/${inv.remove.id}`), { keptId: inv.keep.id, removedId: inv.remove.id, mergeId, mergedAt: at, mergedBy: actor.uid, originalTitle: inv.remove.title || '' });
    return { mergeId, keptId: inv.keep.id, removedId: inv.remove.id, before: inv.keep, removed: inv.remove, after: saved };
  });
  try {
    await refreshConflicts([{ id: result.keptId, before: result.before, after: result.after }, { id: result.removedId, before: result.removed }]);
    return { mergeId: result.mergeId, keptId: result.keptId, removedId: result.removedId, conflictRefreshPending: false };
  } catch (error) {
    // The merge already committed. Report the refresh issue without suggesting that the merge be retried.
    logError?.('Conflict refresh after event merge failed', { keptId: result.keptId, removedId: result.removedId, error });
    return { mergeId: result.mergeId, keptId: result.keptId, removedId: result.removedId, conflictRefreshPending: true };
  }
}

module.exports = { inventory, requireAccess, preview, execute, mergeKey, associationKey, MAX_LINKS };
