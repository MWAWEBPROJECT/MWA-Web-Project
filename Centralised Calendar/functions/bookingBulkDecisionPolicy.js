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
function classifyConflicts(startAt, endAt, overlaps) {
  const start = Date.parse(startAt), end = Date.parse(endAt);
  const actual = [], bufferOnly = [];
  for (const row of overlaps) {
    const otherStart = Date.parse(row.startAt), otherEnd = Date.parse(row.endAt);
    if (![start, end, otherStart, otherEnd].every(Number.isFinite) || start < otherEnd && end > otherStart) actual.push(row);
    else bufferOnly.push(row);
  }
  return { actual, bufferOnly };
}
function checkApprovalConflicts({ venueId, startAt, endAt, overlaps, requireNoConflict, bufferOverride, note, HttpsError }) {
  checkConflict(overlaps, requireNoConflict, HttpsError);
  const { actual, bufferOnly } = classifyConflicts(startAt, endAt, overlaps);
  if (actual.length) throw new HttpsError('failed-precondition', 'This booking overlaps another booking in actual time. Change its venue, audience or time before approving.');
  if (bufferOnly.some(row => row.venueId !== venueId)) throw new HttpsError('failed-precondition', 'This booking conflicts with the venue availability policy across different areas. Change the venue, audience or time before approving.');
  if (bufferOnly.length && bufferOverride !== true) throw new HttpsError('failed-precondition', 'This booking only conflicts with a scheduling buffer. An admin may waive the buffer with a decision note.');
  if (bufferOnly.length && String(note || '').trim().length < 5) throw new HttpsError('invalid-argument', 'Enter a reason of at least five characters to waive the scheduling buffer.');
  return bufferOnly;
}
function checkUnchanged(latest, before, expectedStatus, HttpsError) {
  if (!latest || latest.status !== expectedStatus || latest.venueId !== before.venueId || latest.startAt !== before.startAt || latest.endAt !== before.endAt) {
    throw new HttpsError('failed-precondition', 'This booking changed. Refresh the list before deciding.');
  }
}
module.exports = { checkBulkRequest, checkPending, checkConflict, classifyConflicts, checkApprovalConflicts, checkUnchanged };
