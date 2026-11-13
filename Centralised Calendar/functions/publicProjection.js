// The ONLY shape in which booking data leaves the server for public callers
// (getPublicEvents callable, GET /v1/events without an admin token, the iCal feed).
//
// Rules:
//   confirmed + public   -> full public projection (title, booking type, venue, times, speaker, program details)
//   confirmed + not public (private/missing) -> masked, title "Private"
//   pending              -> masked, title "Unconfirmed booking" (regardless of visibility)
//   rejected / cancelled / anything else -> null (never exposed)
//
// Masked items intentionally carry only: id, status, times, venue, hijri info, and the
// masked title. No contact details, notes, department, requested visibility or
// conflict data. Built as a whitelist (never by deleting fields from the raw doc) so
// any field added to events later is private by default.
const MASKED_TITLES = { private: 'Private', pending: 'Unconfirmed booking' };

// MWA Programs events are never private: once confirmed they are always public.
const ALWAYS_PUBLIC_DEPARTMENT = 'mwa programs';
function isAlwaysPublicDepartment(name) {
  return String(name || '').trim().toLowerCase() === ALWAYS_PUBLIC_DEPARTMENT;
}

function projectPublicEvent(d, id, hijri) {
  if (!d) return null;
  const base = {
    id,
    status: d.status,
    startAt: d.startAt,
    endAt: d.endAt,
    venueId: d.venueId,
    venueName: d.venueName || null,
    dateBasis: d.dateBasis || 'gregorian',
    hijri: hijri || null
  };
  if (d.status === 'confirmed' && (d.visibility === 'public' || isAlwaysPublicDepartment(d.departmentName))) {
    return {
      ...base,
      title: d.title,
      audience: d.audience || 'family',
      departmentId: d.departmentId,
      departmentName: d.departmentName || null,
      speakerName: d.speakerName || '',
      programDetails: d.programDetails || '',
      startPrayer: d.startPrayer || null,
      endPrayer: d.endPrayer || null,
      visibility: 'public',
      masked: false
    };
  }
  if (d.status === 'confirmed') return { ...base, title: MASKED_TITLES.private, masked: true };
  if (d.status === 'pending') return { ...base, title: MASKED_TITLES.pending, masked: true };
  return null;
}

module.exports = { projectPublicEvent, isAlwaysPublicDepartment, MASKED_TITLES };
