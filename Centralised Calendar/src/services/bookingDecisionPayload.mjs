export function bookingDecisionPayload({ eventId, status, visibility, note, expectedStatus, requireNoConflict, bufferOverride }) {
  const payload = { eventId, status, visibility, note };
  if (expectedStatus != null) payload.expectedStatus = expectedStatus;
  if (requireNoConflict === true) payload.requireNoConflict = true;
  if (bufferOverride === true) payload.bufferOverride = true;
  return payload;
}
