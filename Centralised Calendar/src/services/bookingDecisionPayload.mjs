export function bookingDecisionPayload({ eventId, status, visibility, note, expectedStatus, requireNoConflict }) {
  const payload = { eventId, status, visibility, note };
  if (expectedStatus != null) payload.expectedStatus = expectedStatus;
  if (requireNoConflict === true) payload.requireNoConflict = true;
  return payload;
}
