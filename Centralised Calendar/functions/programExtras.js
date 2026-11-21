'use strict';
// Admin-only "program extras" for MWA Programs bookings: reciters, volunteers and
// expenses. They live on the event document (admin-read only per firestore.rules), are edited only
// through the updateProgramExtras callable, and are never part of the public projection.

const LIMITS = { list: 50, name: 120, short: 60, notes: 500 };

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function itemId(v, i) {
  const s = text(v, 40).replace(/[^A-Za-z0-9_-]/g, '');
  return s || `i${Date.now().toString(36)}${i}`;
}

function sanitizeList(list, label, mapItem) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(`${label} must be a list.`);
  if (list.length > LIMITS.list) throw new Error(`${label}: at most ${LIMITS.list} entries.`);
  return list
    .filter(x => x && typeof x === 'object')
    .map((x, i) => ({ id: itemId(x.id, i), ...mapItem(x) }))
    .filter(x => x.name || x.description);
}

function parseAmount(v) {
  if (v === '' || v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error('Expense amount must be a positive number.');
  return Math.round(n * 100) / 100;
}

/**
 * Validates a partial extras patch. Only keys present in `input` are returned, so callers can
 * update one section at a time. Throws Error with a user-facing message on invalid input.
 */
function sanitizeProgramExtras(input) {
  const src = input && typeof input === 'object' ? input : {};
  if ('niazSponsor' in src) throw new Error('Use Niaz assignments to manage sponsors for this event.');
  const out = {};
  if ('reciters' in src) {
    out.reciters = sanitizeList(src.reciters, 'Reciters', x => ({
      name: text(x.name, LIMITS.name), role: text(x.role, LIMITS.short), notes: text(x.notes, LIMITS.notes)
    }));
  }
  if ('volunteers' in src) {
    out.volunteers = sanitizeList(src.volunteers, 'Volunteers', x => ({
      name: text(x.name, LIMITS.name), phone: text(x.phone, LIMITS.short), duty: text(x.duty, LIMITS.name)
    }));
  }
  if ('expenses' in src) {
    out.expenses = sanitizeList(src.expenses, 'Expenses', x => ({
      description: text(x.description, LIMITS.name), amount: parseAmount(x.amount),
      paidBy: text(x.paidBy, LIMITS.name), notes: text(x.notes, LIMITS.notes)
    }));
  }
  return out;
}

const expensesTotal = (expenses) =>
  Math.round((expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0) * 100) / 100;

module.exports = { sanitizeProgramExtras, expensesTotal, PROGRAM_EXTRA_KEYS: ['reciters', 'volunteers', 'expenses'] };
