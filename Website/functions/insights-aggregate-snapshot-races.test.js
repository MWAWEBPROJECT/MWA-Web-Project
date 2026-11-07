const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const Aggregate = require('./insights-aggregate-snapshot');
const Snapshot = require('./insights-multi-snapshot');
const State = require('./insights-state');
const Mapping = require('./insights-mapping');

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const stamp = doc => `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`;
const key = (form, id) => createHash('sha256').update(`${form}:${id}`).digest('hex');
const conflict = error => error.status === 409;

test('aggregate snapshot fences progress, reviewed filters, identity, expiry and authorization',
  { skip: !enabled, timeout: 120000 }, async () => {
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore, Timestamp } = require('firebase-admin/firestore');
    const app = initializeApp({ projectId: 'demo-aggregate-races' }, randomUUID());
    const db = getFirestore(app);
    const actor = { uid: 'tester', email: 'tester@example.invalid', provider: 'google.com',
      modules: ['form-insights', 'form-insights-people', 'form-insights-export'] };
    const form = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const fields = [{ id: 'name', type: 'text', label: 'Name', required: true, options: [] }];
    const input = { dateMode: 'custom', from: '2026-01-01', to: '2026-12-31', basis: 'submission',
      search: '', categories: ['education'], bookingType: 'type', series: 'series', formId: form };
    const finish = async initial => {
      let job = initial;
      while (job.status === 'running') job = await Aggregate.step(db, actor, { jobId: job.jobId, step: job.step, search: '' });
      return job;
    };
    try {
      await db.doc('users/tester').set({ role: 'admin', email: actor.email });
      await db.doc('adminAllowlist/' + actor.email).set({ uid: actor.uid, modules: actor.modules });
      await db.doc('_insightsState/fieldMappings/forms/' + form + '/revisions/1').set({
        status: 'reviewed', version: 1, schemaHash: Mapping.hashSchema(Mapping.schema(fields)),
        entries: [{ fieldId: 'name', role: 'respondent-name', concept: '' }]
      });
      await db.doc('events/one').set({ title: 'One', status: 'confirmed', visibility: 'public',
        startAt: '2026-05-01T00:00:00.000Z', departmentId: 'type', seriesId: 'series' });
      await db.doc('events/two').set({ title: 'Two', status: 'confirmed', visibility: 'public',
        startAt: '2026-06-01T00:00:00.000Z', departmentId: 'other', seriesId: 'series' });
      await db.doc('_insightsState/programmeCategories/items/education').set({ name: 'Education' });
      for (const eventId of ['one', 'two']) {
        const event = await db.doc('events/' + eventId).get();
        await db.doc('_insightsState/programmeAssignments/events/' + eventId).set({
          version: 1, categoryIds: ['education'], eventVersion: stamp(event)
        });
        const id = 'r_' + eventId;
        await db.doc(`registrationForms/${form}/responses/${id}`).set({
          reference: id, formTitle: 'Synthetic', revision: 1, fields, answers: { name: 'Synthetic' },
          eventId, createdAt: '2026-03-01T00:00:00.000Z'
        });
        await db.doc('_registrationInsights/' + key(form, id)).set({
          formId: form, responseId: id, eventId, reference: id, formTitle: 'Synthetic',
          submittedAt: '2026-03-01T00:00:00.000Z', search: 'synthetic'
        });
      }

      let job = await Aggregate.start(db, actor, input);
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId }), conflict);
      const concurrent = await Promise.allSettled([
        Aggregate.step(db, actor, { jobId: job.jobId, step: 0, search: '' }),
        Aggregate.step(db, actor, { jobId: job.jobId, step: 0, search: '' })
      ]);
      assert.equal(concurrent.filter(value => value.status === 'fulfilled').length, 1);
      assert.equal(concurrent.filter(value => value.status === 'rejected' && conflict(value.reason)).length, 1);
      job = await finish(concurrent.find(value => value.status === 'fulfilled').value);
      const result = await Aggregate.results(db, actor, { jobId: job.jobId });
      assert.equal(result.submissions, 1);
      assert.deepEqual(result.months, [{ month: '2026-03', count: 1 }]);
      assert.equal(result.items[0].reference, 'r_one');
      assert.equal((await Aggregate.results(db, actor, { jobId: job.jobId, export: 'xlsx' })).submissions, 1);
      await db.doc('adminAllowlist/' + actor.email).update({ modules: ['form-insights', 'form-insights-people'] });
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId, export: 'xlsx' }), error => error.status === 403);
      assert.equal((await Aggregate.results(db, actor, { jobId: job.jobId })).submissions, 1);
      await db.doc('adminAllowlist/' + actor.email).update({ modules: actor.modules });
      await db.doc('_insightsState/programmeCategories/items/education').update({ name: 'Updated' });
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId }), conflict);

      job = await Aggregate.start(db, actor, input);
      job = await Aggregate.step(db, actor, { jobId: job.jobId, step: 0, search: '' });
      await db.doc('events/one').update({ title: 'Changed' });
      await assert.rejects(Aggregate.step(db, actor, { jobId: job.jobId, step: job.step, search: '' }), conflict);

      job = await finish(await Aggregate.start(db, actor, input));
      await db.doc('_insightsState/respondentVersion').set({ revision: randomUUID() });
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId, export: 'pdf' }), conflict);

      job = await Aggregate.start(db, actor, input);
      await State.recordSourceChange(db, form);
      await assert.rejects(Aggregate.step(db, actor, { jobId: job.jobId, step: 0, search: '' }), conflict);
      await Snapshot.cancel(db, actor, { jobId: job.jobId });
      await Snapshot.cancel(db, actor, { jobId: job.jobId });
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId }), conflict);

      job = await finish(await Aggregate.start(db, actor, input));
      await db.doc('adminAllowlist/' + actor.email).update({ modules: ['form-insights'] });
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId }), error => error.status === 403);
      await db.doc('adminAllowlist/' + actor.email).update({ modules: actor.modules });
      await db.doc('_insightsMultiJobs/' + job.jobId).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId }), conflict);
      let cleaned;
      do { cleaned = await Snapshot.cleanupExpired(db, job.jobId); } while (!cleaned.done);
      assert.equal((await db.doc('_insightsMultiJobs/' + job.jobId).get()).exists, false);
      assert.equal((await db.doc('_insightsMultiJobs/' + job.jobId).collection('members').get()).size, 0);
      assert.equal((await db.doc('_insightsMultiJobs/' + job.jobId).collection('ledger').get()).size, 0);
      assert.equal((await db.doc(`registrationForms/${form}/responses/r_one`).get()).exists, true);
      assert.equal((await db.doc('events/one').get()).exists, true);

      job = await Aggregate.start(db, actor, input);
      await db.doc('_insightsMultiJobs/' + job.jobId).update({ scanned: Snapshot.MAX_SCANNED });
      await assert.rejects(Aggregate.step(db, actor, { jobId: job.jobId, step: 0, search: '' }), error => error.status === 422);
      await assert.rejects(Aggregate.results(db, actor, { jobId: job.jobId }), conflict);
    } finally { await db.terminate(); await deleteApp(app); }
  });
