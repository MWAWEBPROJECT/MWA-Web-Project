const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment, assertFails, assertSucceeds
} = require('@firebase/rules-unit-testing');
const { collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, where } = require('firebase/firestore');

const emulator = process.env.FIRESTORE_EMULATOR_HOST || '';
const [host, rawPort] = emulator.split(':');
const projectId = 'demo-mwa-rules';
let environment;

test('Firestore rules enforce verified UID-bound admin access and deny direct writes', {
  skip: !emulator
}, async t => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port: Number(rawPort),
      rules: readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    }
  });
  t.after(() => environment.cleanup());

  const seed = async (documents) => environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await Promise.all(Object.entries(documents).map(([documentPath, data]) =>
      setDoc(doc(firestore, documentPath), data)
    ));
  });
  const context = (uid, email, verified = true, provider = 'google.com') =>
    environment.authenticatedContext(uid, {
      email, email_verified: verified, firebase: { sign_in_provider: provider }
    }).firestore();
  const ownerEmail = 'admin@muhammadiwelfare.org.au';
  const teamEmail = 'team@example.org';
  const eventPath = 'events/private-booking';
  const event = { title: 'Private booking', contactEmail: 'private@example.org', status: 'pending' };
  const grant = (uid, modules = ['events-bookings'], accessExpiresAt = null) =>
    ({ uid, modules, accessExpiresAt });

  await seed({
    'events/private-booking': event,
    'venues/hall': { name: 'Main Hall' },
    'users/owner-uid': { role: 'admin', email: ownerEmail },
    'users/team-uid': { role: 'admin', email: teamEmail },
    [`adminAllowlist/${teamEmail}`]: grant('team-uid'),
    '_insightsDetailGrants/team@example.org': { uid: 'team-uid', revision: 1 },
    '_insightsDetailJobs/synthetic': { uid: 'team-uid', status: 'running' },
    '_insightsMultiJobs/synthetic': { uid: 'team-uid', status: 'complete' },
    '_insightsMultiJobs/synthetic/members/person': { bits: 3 },
    '_insightsMultiJobs/synthetic/ledger/00': { entries: { 'events/example': 'missing' } },
    '_registrationPosterCleanup/synthetic': { formId: 'synthetic', key: 'synthetic' },
    '_hijriRecoveryRuns/synthetic': { state: 'pending' },
    '_hijriRecoveryRuns/synthetic/pages/0/tasks/task': { state: 'delivery' },
    '_hijriNotificationReview/synthetic': { resolved: false },
    '_respondents/synthetic': { createdBy: 'owner-uid' },
    '_respondentLinks/synthetic': { personId: 'synthetic' },
    '_respondentMerges/synthetic': { status: 'merged' },
    '_respondentContacts/synthetic/links/source': { personId: 'synthetic' },
    'registrationForms/synthetic/responses/response-one': {eventId:'synthetic-event',answers:{email:'example@example.invalid'}},
    'other/synthetic/responses/other-response': {eventId:'synthetic-event',answers:{email:'example@example.invalid'}},
    'calendarSettings/auth': { passwordLoginDisabled: false }
  });

  await t.test('public browsing cannot directly read bookings or write events', async () => {
    const guest = environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(guest, eventPath)));
    await assertSucceeds(getDoc(doc(guest, 'venues/hall')));
    await assertFails(setDoc(doc(guest, eventPath), event));
  });

  await t.test('verified owner and matching active module grant can read; direct writes remain server-only', async () => {
    const owner = context('owner-uid', ownerEmail);
    const team = context('team-uid', teamEmail);
    assert.equal((await assertSucceeds(getDoc(doc(owner, eventPath)))).data().title, event.title);
    assert.equal((await assertSucceeds(getDoc(doc(team, eventPath)))).data().title, event.title);
    await assertFails(setDoc(doc(team, eventPath), { ...event, title: 'Forged change' }));
  });

  await t.test('detail-export grants and job metadata are server-only even for owner', async () => {
    for (const firestore of [context('owner-uid', ownerEmail), context('team-uid', teamEmail)]) {
      for (const target of ['_insightsDetailGrants/team@example.org', '_insightsDetailJobs/synthetic', '_insightsMultiJobs/synthetic', '_insightsMultiJobs/synthetic/members/person', '_insightsMultiJobs/synthetic/ledger/00', '_registrationPosterCleanup/synthetic', '_hijriRecoveryRuns/synthetic', '_hijriRecoveryRuns/synthetic/pages/0/tasks/task', '_hijriNotificationReview/synthetic', '_respondents/synthetic', '_respondentLinks/synthetic', '_respondentMerges/synthetic', '_respondentContacts/synthetic/links/source', '_insightsState/programmeCategories/items/synthetic', '_insightsState/programmeAssignments/events/synthetic']) {
        await assertFails(getDoc(doc(firestore, target)));
        await assertFails(setDoc(doc(firestore, target), { forged: true }));
      }
    }
  });

  await t.test('response documents and collection-group queries remain denied despite overlapping paths', async () => {
    for (const firestore of [context('owner-uid', ownerEmail), context('team-uid', teamEmail)]) {
      await assertFails(getDoc(doc(firestore, 'registrationForms/synthetic/responses/response-one')));
      await assertFails(getDoc(doc(firestore, 'other/synthetic/responses/other-response')));
      await assertFails(getDocs(query(collectionGroup(firestore, 'responses'), where('eventId', '==', 'synthetic-event'))));
    }
  });

  await t.test('unverified, changed-email, mismatched-UID, expired, revoked and ungranted sessions are denied', async () => {
    await assertFails(getDoc(doc(context('owner-uid', ownerEmail, false), eventPath)));
    await assertFails(getDoc(doc(context('team-uid', 'changed@example.org'), eventPath)));
    await assertFails(getDoc(doc(context('other-uid', teamEmail), eventPath)));

    await seed({
      'adminAllowlist/team@example.org': grant('team-uid', ['events-bookings'], Timestamp.fromMillis(Date.now() - 1000)),
      'adminAllowlist/limited@example.org': grant('limited-uid', ['tools-automation']),
      'users/limited-uid': { role: 'admin', email: 'limited@example.org' },
      'adminAllowlist/revoked@example.org': grant('revoked-uid'),
      'users/revoked-uid': { role: 'admin', email: 'revoked@example.org' }
    });
    await assertFails(getDoc(doc(context('team-uid', teamEmail), eventPath)));
    await assertFails(getDoc(doc(context('limited-uid', 'limited@example.org'), eventPath)));
    await environment.withSecurityRulesDisabled(async admin => {
      await deleteDoc(doc(admin.firestore(), 'adminAllowlist/revoked@example.org'));
    });
    await assertFails(getDoc(doc(context('revoked-uid', 'revoked@example.org'), eventPath)));
  });

  await t.test('disabled password sign-in loses admin access, including for owner', async () => {
    await seed({ 'calendarSettings/auth': { passwordLoginDisabled: true } });
    await assertFails(getDoc(doc(context('team-uid', teamEmail, true, 'password'), eventPath)));
    await assertFails(getDoc(doc(context('owner-uid', ownerEmail, true, 'password'), eventPath)));
  });
});
