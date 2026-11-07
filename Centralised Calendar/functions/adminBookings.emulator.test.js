const test = require('node:test');
const assert = require('node:assert/strict');

test('admin all-years callable pages every synthetic booking and retains range and permission boundaries',
  { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
    delete process.env.FIREBASE_CONFIG;
    process.env.GCLOUD_PROJECT = 'demo-mwa-all-bookings';
    const { getFirestore } = require('firebase-admin/firestore');
    const { getAdminEvents, getPublicEvents } = require('./index');
    const db = getFirestore();
    const email = 'admin@muhammadiwelfare.org.au';
    const auth = { uid: 'synthetic-owner', token: { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
    const batch = db.batch();
    batch.set(db.doc('users/synthetic-owner'), { role: 'admin', email });
    for (let i = 0; i < 251; i++) {
      const year = 2024 + i % 6;
      batch.set(db.doc(`events/synthetic-${String(i).padStart(3, '0')}`), {
        startAt: `${year}-06-01T00:00:00.000Z`, endAt: `${year}-06-01T01:00:00.000Z`,
        title: `Synthetic booking ${i}`, status: 'confirmed', visibility: i % 2 ? 'public' : 'private'
      });
    }
    await batch.commit();
    await assert.rejects(() => getAdminEvents.run({ data: { allTime: true } }), { code: 'unauthenticated' });
    await assert.rejects(() => getAdminEvents.run({
      auth: { uid: 'not-admin', token: { email: 'nobody@example.invalid', email_verified: true } }, data: { allTime: true }
    }), { code: 'permission-denied' });
    await assert.rejects(() => getAdminEvents.run({ auth, data: { allTime: true, from: '2024-01-01' } }), { code: 'invalid-argument' });
    const from = '2024-01-01T00:00:00.000Z', to = '2030-01-01T00:00:00.000Z';
    await assert.rejects(() => getAdminEvents.run({ auth, data: { from, to } }), { code: 'invalid-argument' });
    await assert.rejects(() => getPublicEvents.run({ data: { from, to } }), { code: 'invalid-argument' });
    const first = await getAdminEvents.run({ auth, data: { allTime: true } });
    const second = await getAdminEvents.run({ auth, data: { allTime: true, cursor: first.nextPageCursor } });
    assert.equal(first.scope, 'all-time');
    assert.equal(second.scope, 'all-time');
    assert.equal(first.events.length, 200);
    assert.equal(second.events.length, 51);
    assert.equal(second.nextPageCursor, null);
    assert.equal(new Set([...first.events, ...second.events].map(event => event.id)).size, 251);
    assert.deepEqual(new Set([...first.events, ...second.events].map(event => event.startAt.slice(0, 4))),
      new Set(['2024', '2025', '2026', '2027', '2028', '2029']));
    const ranged = await getAdminEvents.run({ auth, data: { from, to: '2024-12-31T00:00:00.000Z' } });
    assert.ok(ranged.events.length > 0 && ranged.events.every(event => event.startAt.startsWith('2024')));
  });
