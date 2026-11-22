'use strict';

const DAY_MS = 86400000;

function validatePair(keep, remove) {
  if (!keep || !remove || !keep.id || !remove.id || keep.id === remove.id) throw new Error('Choose two different events.');
  if (!['pending', 'confirmed'].includes(keep.status) || !['pending', 'confirmed'].includes(remove.status)) throw new Error('Both events must be pending or confirmed.');
  if (keep.departmentName?.toLowerCase() !== 'mwa programs' || remove.departmentName?.toLowerCase() !== 'mwa programs') throw new Error('Only MWA programmes can be merged.');
  const ks = Date.parse(keep.startAt), ke = Date.parse(keep.endAt), rs = Date.parse(remove.startAt), re = Date.parse(remove.endAt);
  if (![ks, ke, rs, re].every(Number.isFinite) || ks >= ke || rs >= re || ks >= re || rs >= ke) throw new Error('Choose two programmes whose booked times overlap.');
  if (keep.venueId !== remove.venueId) throw new Error('Choose programmes in the same venue.');
  if (Math.abs(ks - rs) >= DAY_MS) throw new Error('Choose programmes on the same day.');
}

function mergedTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length < 3 || title.length > 160) throw new Error('Enter a combined title between 3 and 160 characters.');
  return title;
}

function selectedItems(keepItems, removeItems, ids, label) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error(`Choose valid ${label}.`);
  const all = new Map([
    ...(Array.isArray(keepItems) ? keepItems : []).filter(item => item && typeof item === 'object' && item.id).map(item => [`keep:${item.id}`, item]),
    ...(Array.isArray(removeItems) ? removeItems : []).filter(item => item && typeof item === 'object' && item.id).map(item => [`remove:${item.id}`, item])
  ]);
  const selected = ids.map(id => all.get(id));
  if (selected.some(item => !item)) throw new Error(`${label} changed. Refresh the merge review.`);
  return selected;
}

module.exports = { validatePair, mergedTitle, selectedItems };
