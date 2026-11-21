/** Process one decision at a time so later approvals see earlier confirmed bookings. */
export async function runBulkBookingDecision(items, status, note, decide, { bufferOverride = false } = {}) {
  if (!['confirmed', 'rejected'].includes(status)) throw new Error('Choose approve or reject.');
  const results = [];
  for (const item of items) {
    if (item.status !== 'pending') {
      results.push({ id: item.id, title: item.title, outcome: 'skipped', reason: 'Booking is no longer pending.' });
      continue;
    }
    try {
      await decide({ eventId: item.id, status, note, expectedStatus: 'pending', requireNoConflict: status === 'confirmed' && !bufferOverride, bufferOverride: status === 'confirmed' && bufferOverride });
      results.push({ id: item.id, title: item.title, outcome: status === 'confirmed' ? 'approved' : 'rejected' });
    } catch (error) {
      results.push({ id: item.id, title: item.title, outcome: 'failed', reason: error?.message || 'Decision could not be completed. Refresh this booking before retrying.' });
    }
  }
  return results;
}
