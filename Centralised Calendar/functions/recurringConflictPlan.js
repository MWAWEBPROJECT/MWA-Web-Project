function canMergeOccurrence(occurrence, conflict, venueId, departmentName) {
  return String(departmentName || '').trim().toLowerCase() === 'mwa programs'
    && String(conflict.departmentName || '').trim().toLowerCase() === 'mwa programs'
    && conflict.venueId === venueId
    && ['pending', 'confirmed'].includes(conflict.status)
    && Date.parse(occurrence.startAt) < Date.parse(conflict.endAt)
    && Date.parse(conflict.startAt) < Date.parse(occurrence.endAt);
}

function planRecurringConflicts(occurrences, refs, overlapMap, decisions, venueId, departmentName) {
  if (!Array.isArray(decisions) || decisions.length > occurrences.length) throw new Error('Review the choices for this recurring series again.');
  const choices = new Map();
  for (const value of decisions) {
    if (!Number.isInteger(value?.index) || choices.has(value.index) || !['skip', 'merge', 'review'].includes(value.action)) throw new Error('Choose one valid action for each conflicting date.');
    choices.set(value.index, value);
  }
  const plan = occurrences.map((occurrence, position) => {
    const conflicts = overlapMap.details.get(refs[position].id) || [];
    const choice = choices.get(occurrence.index);
    if (!conflicts.length) {
      if (choice) throw new Error('The series conflicts changed. Preview it again.');
      return { occurrence, position, action: 'create' };
    }
    if (!choice) throw new Error('Choose how to handle every conflicting date before creating the series.');
    if (choice.action === 'skip') return { occurrence, position, action: 'skip' };
    if (choice.action === 'review') return { occurrence, position, action: 'review' };
    if (conflicts.length !== 1 || conflicts[0].id !== choice.conflictId || !canMergeOccurrence(occurrence, conflicts[0], venueId, departmentName)) {
      throw new Error('This clash cannot be merged, or the conflict changed. Preview the series again.');
    }
    return { occurrence, position, action: 'merge', existingId: choice.conflictId };
  });
  if (choices.size !== plan.filter(item => item.action !== 'create').length) throw new Error('The series choices changed. Preview it again.');
  if (plan.every(item => item.action === 'skip')) throw new Error('Choose at least one date to create.');
  return plan;
}

module.exports = { canMergeOccurrence, planRecurringConflicts };
