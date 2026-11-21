function checkBulkRequest(expectedStatus, HttpsError) {
  // Callable transport can encode an omitted optional field as null.
  if (expectedStatus != null && expectedStatus !== 'pending') throw new HttpsError('invalid-argument', 'Only pending bookings may be selected for a bulk decision.');
}
function checkPending(before, expectedStatus, HttpsError) {
  if (expectedStatus && before?.status !== expectedStatus) throw new HttpsError('failed-precondition', 'This booking is no longer pending. Refresh the list.');
}
function checkConflict(overlaps, requireNoConflict, HttpsError) {
  if (requireNoConflict === true && overlaps.length) throw new HttpsError('failed-precondition', 'This booking has a venue conflict. Review it individually before approving.');
}
function checkUnchanged(latest, before, expectedStatus, HttpsError) {
  if (!latest || latest.status !== expectedStatus || latest.venueId !== before.venueId || latest.startAt !== before.startAt || latest.endAt !== before.endAt) {
    throw new HttpsError('failed-precondition', 'This booking changed. Refresh the list before deciding.');
  }
}
module.exports = { checkBulkRequest, checkPending, checkConflict, checkUnchanged };
