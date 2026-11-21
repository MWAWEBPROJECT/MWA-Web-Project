const test = require('node:test');
const assert = require('node:assert');
const { sanitizeProgramExtras, expensesTotal } = require('./programExtras');
const { projectPublicEvent } = require('./publicProjection');

test('program extras: partial patches, trimming, empty rows dropped', () => {
  const out = sanitizeProgramExtras({
    reciters: [{ name: 'Reciter A', role: 'Noha' }, { name: '  ' }],
    expenses: [{ description: 'Food', amount: '$1,250.50' }, { description: 'Flowers', amount: 40 }]
  });
  assert.equal(out.reciters.length, 1);
  assert.ok(out.reciters[0].id);
  assert.equal('volunteers' in out, false);
  assert.equal(expensesTotal(out.expenses), 1290.5);
  assert.throws(() => sanitizeProgramExtras({ niazSponsor: { name: 'Ali Family' } }), /Niaz assignments/);
});

test('program extras: invalid amounts and oversized lists are rejected', () => {
  assert.throws(() => sanitizeProgramExtras({ expenses: [{ description: 'x', amount: '-5' }] }), /positive number/);
  assert.throws(() => sanitizeProgramExtras({ volunteers: Array.from({ length: 51 }, () => ({ name: 'v' })) }), /at most 50/);
  assert.throws(() => sanitizeProgramExtras({ reciters: 'nope' }), /must be a list/);
});

test('program extras never reach the public projection', () => {
  const p = projectPublicEvent({
    id: 'e1', title: 'Majlis', status: 'confirmed', visibility: 'public',
    startAt: '2026-06-21T08:00:00.000Z', endAt: '2026-06-21T10:00:00.000Z',
    speakerName: 'Sheikh A', niazSponsor: { name: 'Ali Family' }, reciters: [{ name: 'R' }],
    volunteers: [{ name: 'V' }], expenses: [{ description: 'Food', amount: 10 }]
  });
  assert.equal(p.speakerName, 'Sheikh A');
  for (const k of ['niazSponsor', 'reciters', 'volunteers', 'expenses']) assert.equal(k in p, false, k);
});
