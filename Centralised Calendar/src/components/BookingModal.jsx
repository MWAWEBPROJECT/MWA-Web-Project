import {audienceError} from '../utils/venuePolicy.js';
import {AUDIENCES} from '../utils/audience.js';
import AdminBackButton from './AdminBackButton.jsx';
import {auth} from '../firebase/firebase.js';
import {onAuthStateChanged} from 'firebase/auth';
import ContactVerification from './ContactVerification.jsx';
import {contactError,verificationPhone} from '../utils/contactVerification.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HIJRI_MONTHS, hijriToGregorian, getHijriParts, getTodayHijriParts } from '../services/hijriService.js';
import { localToUtcIso, formatInOrgTz, dateKeyInOrgTz, timeKeyInOrgTz } from '../utils/dateUtils.js';
import { adjustPublicBookingStart, earliestAllowedPublicStart, MIN_PUBLIC_LEAD_HOURS } from '../utils/publicLeadTime.js';
import {
  submitBooking, decideBooking, updateBookingScoped, createRecurringBooking, deleteBooking,
  checkSlotConflicts, previewRecurringBooking, startBookingVerification,
  verifyBookingEmailCode, verifyBookingMobile
} from '../services/eventsService.js';
import { clearBookingPhoneRecaptcha, confirmBookingPhoneCode, sendBookingPhoneCode } from '../services/phoneBookingAuth.js';
import {
  PRAYER_OPTIONS, MAX_OFFSET_MINUTES, calculatePrayerTimes, prayerLabel, applyPrayerOffset, resolvePrayerSchedule
} from '../utils/prayerTimes.js';
import { ProgramExtrasSummary, ProgramExtrasEditor } from './ProgramExtras.jsx';
import NiazPublicSponsors from './NiazPublicSponsors.jsx';
import SeriesDeletePrompt from './SeriesDeletePrompt.jsx';
import { availableBookingTypes } from '../utils/bookingTypes.js';

// Speaker / program details / prayer-time (variable) scheduling apply to this booking type only.
const PROGRAM_TYPE_NAME = 'mwa programs';
const isProgramType = (departments, id) =>
  String(departments.find(d => d.id === id)?.name || '').trim().toLowerCase() === PROGRAM_TYPE_NAME;

function prayerNote(p) {
  if (!p || !p.key) return '';
  const off = Number(p.offset) || 0;
  return `${prayerLabel(p.key)}${off ? ` ${off > 0 ? '+' : '−'}${Math.abs(off)} min` : ''}`;
}

const todayStr = () => dateKeyInOrgTz(new Date().toISOString());
// All day / all night windows (Australia/Sydney civil time). All night crosses midnight.
const TIME_MODES = {
  allDay: { start: '00:00', end: '23:59', endNextDay: false },
  allNight: { start: '18:00', end: '06:00', endNextDay: true }
};

function addDays(dateStr, n) {
  const t = new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

function fmtHijri(h) {
  if (!h || !h.year) return '';
  return `${h.day} ${HIJRI_MONTHS.find(m => m.value === h.month)?.name || ''} ${h.year} AH`;
}

const fmtRange = (s, e) => `${formatInOrgTz(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} – ${formatInOrgTz(e, { hour: '2-digit', minute: '2-digit', hour12: false })}`;

const DEFAULT_REPEAT = { on: false, frequency: 'week', repeatEvery: 1, endMode: 'count', count: 10, endDate: '', status: 'confirmed' };

export function BookingModalInner({
  open, onClose, venues, departments, editing: selectedBooking, isAdmin, hijriOverrides, onSaved, initialDate
}) {
  const [sessionUser,setSessionUser]=useState(auth.currentUser);
  useEffect(()=>onAuthStateChanged(auth,setSessionUser),[]);
  const authenticated=!!sessionUser&&!sessionUser.isAnonymous&&(sessionUser.emailVerified||!!sessionUser.phoneNumber);
  const needsVerification=!isAdmin&&!authenticated;
  useEffect(()=>()=>clearBookingPhoneRecaptcha(),[]);
  // The selected list item is a snapshot and may disappear from its filtered list after a decision.
  const [savedBooking, setSavedBooking] = useState(null);
  const editing = savedBooking || selectedBooking;
  const [form, setForm] = useState(() => emptyForm(editing, initialDate, isAdmin));
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  // Disables the submit button after a *successful* submission until the
  // user edits any field again; failed attempts stay retryable.
  const [locked, setLocked] = useState(false);
  // Existing bookings open read-only; admins press Edit to enable the fields.
  const [editMode, setEditMode] = useState(false);
  const [scope, setScope] = useState('single');
  const [deletePrompt, setDeletePrompt] = useState(false);
  const [rep, setRep] = useState(DEFAULT_REPEAT);
  const [conflict, setConflict] = useState(null);
  const [conflictErr, setConflictErr] = useState('');
  const [preview, setPreview] = useState(null);
  const [protectionWarning, setProtectionWarning] = useState('');
  const [verificationMethod, setVerificationMethod] = useState('email');
  const [bookingVerification, setBookingVerification] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [resendClock, setResendClock] = useState(Date.now());
  const [phoneConfirmation, setPhoneConfirmation] = useState(null);
  const [phoneIdToken, setPhoneIdToken] = useState('');
  const verificationSessionId = useRef(null);
  if (!verificationSessionId.current) {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    verificationSessionId.current = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Admin-only MWA Programs extras saved in this dialog (the `editing` prop may lag the live snapshot).
  const [extras, setExtras] = useState(null);
  const [extrasSection, setExtrasSection] = useState(null);

  useEffect(() => {
    setSavedBooking(null);
    setForm(emptyForm(selectedBooking, initialDate, isAdmin));
    setErr(''); setOk(''); setLocked(false); setEditMode(false); setScope('single');
    setRep(DEFAULT_REPEAT); setConflict(null); setPreview(null);
    setProtectionWarning(''); setExtras(null); setExtrasSection(null);
    setBookingVerification(null); setVerificationCode(''); setPhoneConfirmation(null); setPhoneIdToken('');
    setResendAt(0);
    setVerificationMethod('email'); clearBookingPhoneRecaptcha();
  }, [selectedBooking, open, initialDate, isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    setBookingVerification(null);
    setVerificationCode('');
    setResendAt(0);
    setPhoneConfirmation(null);
    setPhoneIdToken('');
    clearBookingPhoneRecaptcha();
  }, [verificationMethod, verificationMethod==='email'?form.contactEmail.trim().toLowerCase():form.contactPhone.replace(/[ ()-]/g,''), isAdmin]);

  useEffect(() => {
    if (!resendAt) return undefined;
    const timer = setInterval(() => setResendClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  useEffect(()=>{if(bookingVerification?.verified&&bookingVerification.expiresAt<=resendClock&&!locked){setBookingVerification(null);setVerificationCode('');setErr('Your contact verification expired. Request a new code; your booking details are saved in this form.');}},[resendClock,bookingVerification,locked]);

  const bookingTypes = useMemo(() => availableBookingTypes(departments, isAdmin), [departments, isAdmin]);
  useEffect(() => {
    if (!open || isAdmin || editing) return;
    setForm(current => bookingTypes.some(type => type.id === current.departmentId)
      ? current : { ...current, departmentId: bookingTypes[0]?.id || '' });
  }, [open, isAdmin, editing, bookingTypes]);

  const gregorianDate = useMemo(() => {
    if (form.basis === 'g') return form.date;
    if (!form.hDay || !form.hMonth || !form.hYear) return '';
    return hijriToGregorian(Number(form.hDay), Number(form.hMonth), Number(form.hYear), hijriOverrides) || '';
  }, [form.basis, form.date, form.hDay, form.hMonth, form.hYear, hijriOverrides]);
  // Switching to Hijri entry pre-fills empty day/month/year from today's Hijri date (Sydney civil date, active adjustment).
  function switchBasis(basis) {
    set('basis', basis);
    if (basis !== 'h') return;
    const h = getTodayHijriParts(hijriOverrides);
    if (!h.year) return;
    setForm(f => ({ ...f, basis, hDay: f.hDay || String(h.day), hMonth: f.hDay ? f.hMonth : String(h.month), hYear: f.hYear || String(h.year) }));
  }


  const hijriPreview = useMemo(() => {
    if (form.basis !== 'g' || !form.date) return '';
    const h = getHijriParts(form.date, hijriOverrides);
    if (!h.year) return '';
    const name = HIJRI_MONTHS.find(m => m.value === h.month)?.name || '';
    return `${h.day} ${name} ${h.year} AH`;
  }, [form.basis, form.date, hijriOverrides]);

  // Booked interval as real instants; "all night" (and any overnight edit) ends on the next civil day.
  const range = useMemo(() => {
    if (!gregorianDate || !form.start || !form.end) return null;
    const startAt = localToUtcIso(gregorianDate, form.start);
    const endAt = localToUtcIso(form.endNextDay ? addDays(gregorianDate, 1) : gregorianDate, form.end);
    return startAt && endAt ? { startAt, endAt } : null;
  }, [gregorianDate, form.start, form.end, form.endNextDay]);

  const isProgram = isProgramType(departments, form.departmentId);
  const startVariable = isProgram && form.timeMode === 'custom' && form.startKind === 'variable';
  const endVariable = isProgram && form.timeMode === 'custom' && form.endKind === 'variable';
  const startPrayer = startVariable ? { key: form.startPrayerKey, offset: Number(form.startOffset) || 0 } : null;
  const endPrayer = endVariable ? { key: form.endPrayerKey, offset: Number(form.endOffset) || 0 } : null;
  const prayerTimesToday = useMemo(() => (gregorianDate ? calculatePrayerTimes(gregorianDate) : null), [gregorianDate]);

  // Variable (prayer) times are recalculated for the MWA centre whenever the date or prayer changes.
  useEffect(() => {
    if (!open || !gregorianDate || (!startVariable && !endVariable)) return;
    const r = resolvePrayerSchedule(gregorianDate, { start: form.start, end: form.end, startPrayer, endPrayer });
    if (!r) return;
    if (r.start !== form.start || r.end !== form.end || r.endNextDay !== form.endNextDay) {
      setForm(f => ({ ...f, start: r.start, end: r.end, endNextDay: r.endNextDay }));
    }
  }, [open, gregorianDate, startVariable, endVariable, form.startPrayerKey, form.startOffset, form.endPrayerKey, form.endOffset,
    form.start, form.end, form.endNextDay]);

  useEffect(() => {
    if (!open || isAdmin || startVariable) return;
    const patch = adjustPublicBookingStart({
      date: gregorianDate,
      start: form.start,
      end: form.end,
      endNextDay: form.endNextDay,
      timeMode: form.timeMode,
      localToUtcIso,
      toOrgTimeParts: (iso) => ({ dateStr: dateKeyInOrgTz(iso), timeStr: timeKeyInOrgTz(iso) }),
      addDays
    });
    if (!patch) return;
    setProtectionWarning(`Public bookings must start at least ${MIN_PUBLIC_LEAD_HOURS} hours from now. The date/time was moved to the earliest available start.`);
    setForm(f => ({
      ...f,
      date: f.basis === 'g' ? patch.date : f.date,
      hDay: f.basis === 'h' ? String(getHijriParts(patch.date, hijriOverrides).day) : f.hDay,
      hMonth: f.basis === 'h' ? String(getHijriParts(patch.date, hijriOverrides).month) : f.hMonth,
      hYear: f.basis === 'h' ? String(getHijriParts(patch.date, hijriOverrides).year) : f.hYear,
      start: patch.start,
      end: patch.end,
      endNextDay: patch.endNextDay
    }));
  }, [open, isAdmin, startVariable, range, gregorianDate, form.start, form.end, form.endNextDay, form.timeMode, form.basis, hijriOverrides]);

  const watchConflicts = open && (!editing || (isAdmin && editing && (editMode || editing.status === 'pending' || editing.status === 'confirmed')));
  // Live, server-side conflict check (confirmed + pending, buffer-aware). Public callers only
  // learn that a conflict exists; admins also see the conflicting bookings.
  useEffect(() => {
    if (!watchConflicts || !form.venueId || !range || new Date(range.endAt) <= new Date(range.startAt)) {
      setConflict(null); setConflictErr(''); return undefined;
    }
    const invalid=audienceError(venues.find(v=>v.id===form.venueId),form.audience);
    if(invalid){setConflict(null);setConflictErr(invalid);return undefined;}
    let cancelled = false;
    const t = setTimeout(() => {
      checkSlotConflicts({ audience:form.audience, venueId: form.venueId, startAt: range.startAt, endAt: range.endAt, excludeId: editing?.id })
        .then(r => { if (!cancelled) { setConflict(r); setConflictErr(''); } })
        .catch(() => { if (!cancelled) { setConflict(null); setConflictErr("Couldn't check conflicts right now. Please retry or reload."); } });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [watchConflicts, form.venueId, form.audience, range, editing?.id]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) { if (e.key === 'Escape') onClose && onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isSeries = !!(editing && editing.seriesId);
  const readOnly = !!editing && !editMode;

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setLocked(false); setPreview(null); setProtectionWarning(''); }
  function setR(k, v) { setRep(r => ({ ...r, [k]: v })); setLocked(false); setPreview(null); }
  function setTimeMode(mode) {
    const w = TIME_MODES[mode];
    setForm(f => (w
      ? { ...f, timeMode: mode, start: w.start, end: w.end, endNextDay: w.endNextDay }
      : { ...f, timeMode: 'custom', endNextDay: false }));
    setLocked(false); setPreview(null); setProtectionWarning('');
  }
  function clearForm() {
    setForm(emptyForm(null, initialDate, isAdmin));
    setRep(DEFAULT_REPEAT); setErr(''); setOk(''); setLocked(false); setConflict(null); setPreview(null);
  }
  function cancelEdit() { setForm(emptyForm(editing, initialDate, isAdmin)); setEditMode(false); setErr(''); setOk(''); }
  // Leaving Variable time on both sides returns to a same-day Fixed window.
  function setKind(side, kind) {
    setForm(f => {
      const next = { ...f, [`${side}Kind`]: kind };
      if (next.startKind !== 'variable' && next.endKind !== 'variable' && f.timeMode === 'custom') next.endNextDay = false;
      return next;
    });
    setLocked(false); setPreview(null); setProtectionWarning('');
  }
  function setBookingType(id) {
    const hadVariable = isProgram && form.timeMode === 'custom' && (form.startKind === 'variable' || form.endKind === 'variable');
    setForm(f => ({ ...f, departmentId: id, ...(hadVariable && !isProgramType(departments, id) ? { endNextDay: false } : {}) }));
    setLocked(false); setPreview(null); setProtectionWarning('');
  }
  const programPayload = () => ({
    speakerName: isProgram ? form.speakerName : '',
    programDetails: isProgram ? form.programDetails : '',
    startPrayer, endPrayer
  });

  function publicBookingPayload() {
    if (!range) throw new Error('Choose a valid booking date and time.');
    return {
      timeMode: form.timeMode,
      title: form.title, departmentId: form.departmentId, venueId: form.venueId, audience: form.audience,
      startAt: range.startAt, endAt: range.endAt,
      dateBasis: form.basis,
      hijriDate: form.basis === 'h' ? { day: Number(form.hDay), month: Number(form.hMonth), year: Number(form.hYear) } : null,
      contactName: form.contactName, contactEmail: form.contactEmail,
      contactPhone: needsVerification && verificationMethod === 'mobile' ? verificationPhone(form.contactPhone) : form.contactPhone,
      notes: form.notes, visibility: form.visibility,
      ...programPayload()
    };
  }

  function chooseVerificationMethod(method) {
    setVerificationMethod(method);
    setBookingVerification(null);
    setVerificationCode('');
    setResendAt(0);
    setPhoneConfirmation(null);
    setPhoneIdToken('');
    clearBookingPhoneRecaptcha();
    setErr('');
  }

  async function startPublicVerification() {
    setErr(''); setOk('');
    setBusy(true);
    try {
      const validation=contactError(verificationMethod,verificationMethod==='email'?form.contactEmail:form.contactPhone);
      if(validation)throw new Error(validation);
      const contactPhone=verificationMethod==='mobile'?verificationPhone(form.contactPhone):form.contactPhone;
      const challenge = await startBookingVerification({
        method: verificationMethod,
        sessionId: verificationSessionId.current,
        contactEmail: form.contactEmail, contactPhone
      });
      setBookingVerification(challenge);
      setResendAt(Date.now() + challenge.resendAfterMs);
      setVerificationCode('');
      setPhoneIdToken('');
      if (verificationMethod === 'mobile') {
        const phone = contactPhone;
        setPhoneConfirmation(await sendBookingPhoneCode(phone));
      }
    } catch (error) {
      setErr(error?.message || 'Could not start contact verification. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublicVerification() {
    if (!bookingVerification) return;
    setErr(''); setBusy(true);
    try {
      if (verificationMethod === 'email') {
        await verifyBookingEmailCode({
          challengeId: bookingVerification.challengeId,
          code: verificationCode,
          sessionId: verificationSessionId.current
        });
      } else {
        let token = phoneIdToken;
        if (!token) {
          if (!phoneConfirmation) throw new Error('Request a mobile verification code first.');
          token = await confirmBookingPhoneCode(phoneConfirmation, verificationCode);
          setPhoneIdToken(token);
          setPhoneConfirmation(null);
        }
        await verifyBookingMobile({
          challengeId: bookingVerification.challengeId,
          idToken: token,
          sessionId: verificationSessionId.current
        });
      }
      setBookingVerification(current => ({ ...current, verified: true }));
      setPhoneIdToken('');
      setOk('Contact verified. Submit your booking request to complete it.');
    } catch (error) {
      setErr(error?.message || 'The verification code could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }

  const closeButton = <button type="button" className="dlg-close" onClick={onClose} aria-label="Close dialog">✕</button>;

  if(!editing && !locked && needsVerification && (!bookingVerification?.verified || bookingVerification.expiresAt<=resendClock)) return (
    <div className="overlay show"><div className="dlg" role="dialog" aria-modal="true" aria-labelledby="booking-verification-title">
      {closeButton}<h3 id="booking-verification-title">Verify your contact</h3>
      <ContactVerification idPrefix="booking" method={verificationMethod} onMethodChange={chooseVerificationMethod}
        contact={verificationMethod==='email'?form.contactEmail:form.contactPhone}
        onContactChange={value=>set(verificationMethod==='email'?'contactEmail':'contactPhone',value)}
        code={verificationCode} onCodeChange={setVerificationCode} challenge={bookingVerification}
        verified={!!bookingVerification?.verified} busy={busy} resendAt={resendAt}
        onSend={startPublicVerification} onVerify={confirmPublicVerification}
        help="First verify your email or mobile. Your booking details come next. No booking is submitted at this step."/>
      {err&&<div className="error" role="alert">{err}</div>}
    </div></div>
  );

  const showExtras = isAdmin && !!editing && isProgramType(departments, editing.departmentId);
  const extrasSummary = showExtras && (
    <ProgramExtrasSummary event={editing} extras={extras} onManage={busy || locked ? undefined : setExtrasSection} />
  );
  const extrasEditor = showExtras && extrasSection && (
    <ProgramExtrasEditor
      eventId={editing.id} section={extrasSection}
      initial={(extras && extrasSection in extras ? extras : editing)[extrasSection]}
      onClose={() => setExtrasSection(null)}
      onSaved={(patch) => { setExtras(x => ({ ...(x || {}), ...patch })); onSaved && onSaved(); }}
    />
  );

  // Everyone first sees the same details card; admins additionally get contact/notes and an Edit
  // button that opens the full form. Non-admins never receive contact/notes; masked items carry only date/time/venue.
  if (editing && (!isAdmin || !editMode)) {
    const dateLabel = formatInOrgTz(editing.startAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const h = editing.hijri;
    const hijriLabel = h && h.year ? `${h.day} ${HIJRI_MONTHS.find(m => m.value === h.month)?.name || ''} ${h.year} AH` : '';
    const hm = (iso) => formatInOrgTz(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
    const sp = prayerNote(editing.startPrayer);
    const ep = prayerNote(editing.endPrayer);
    const nextDay = dateKeyInOrgTz(editing.endAt) !== dateKeyInOrgTz(editing.startAt);
    const statusLabel = editing.status === 'pending' ? (isAdmin ? 'pending' : 'unconfirmed') : editing.status;
    return (
      <div className="overlay show" onClick={onClose}>
        <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title" onClick={e => e.stopPropagation()}>
          {closeButton}
          <h3 id="booking-modal-title" style={{ marginTop: 0, paddingRight: 36 }}>{editing.title}</h3>
          <div className="card view-card">
            <div>
              <span className={`tag st-${editing.status}`}>{statusLabel}</span>
              {isAdmin && editing.hasConflict && <span className="conflict-badge">Overlaps another booking at this venue</span>}
            </div>
            <div style={{ marginTop: 8 }}><b>Date:</b> {dateLabel}</div>
            {hijriLabel && <div><b>Hijri:</b> {hijriLabel}</div>}
            <div>
              <b>Time:</b> {hm(editing.startAt)}{sp ? ` (${sp})` : ''} – {hm(editing.endAt)}{ep ? ` (${ep})` : ''}{nextDay ? ' next day' : ''}
            </div>
            <div><b>Audience:</b> {AUDIENCES[editing.audience || 'family']}</div>
            {editing.venueName && <div><b>Venue:</b> {editing.venueName}</div>}
            {!editing.masked && editing.departmentName && <div><b>Booking type:</b> {editing.departmentName}</div>}
            {!editing.masked && editing.speakerName && <div><b>Speaker:</b> {editing.speakerName}</div>}
            {!editing.masked && editing.programDetails && <div className="pre-wrap"><b>Program details:</b> {editing.programDetails}</div>}
            {isAdmin && (
              <>
                {editing.seriesId && <div><b>Series:</b> occurrence {editing.seriesIndex || '?'} of {editing.seriesCount || '?'}</div>}
                <div><b>Visibility:</b> {editing.visibility === 'public' ? 'Public' : 'Private'}</div>
                {(editing.contactName || editing.contactEmail) && (
                  <div><b>Contact:</b> {[editing.contactName, editing.contactEmail, editing.contactPhone].filter(Boolean).join(' · ')}</div>
                )}
                {editing.notes && <div className="pre-wrap"><b>Notes:</b> {editing.notes}</div>}
              </>
            )}
          </div>
          {extrasSummary}
          {!editing.masked&&editing.status==='confirmed'&&(String(editing.departmentName||'').trim().toLowerCase()===PROGRAM_TYPE_NAME||isProgramType(departments,editing.departmentId))&&<NiazPublicSponsors eventId={editing.id} startAt={editing.startAt}/>}
          {ok && <div className="ok" role="status">{ok}</div>}
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn pri" onClick={() => { setEditMode(true); setOk(''); }}>Edit</button>
            </div>
          )}
        </div>
        {extrasEditor}
      </div>
    );
  }

  function seriesPayload() {
    const recurrence = {
      basis: form.basis === 'h' ? 'hijri' : 'gregorian',
      startTime: form.start, endTime: form.end, endNextDay: !!form.endNextDay,
      frequency: rep.frequency, repeatEvery: Number(rep.repeatEvery),
      endMode: rep.endMode, count: Number(rep.count), endDate: rep.endDate
    };
    if (form.basis === 'h') recurrence.hijriStart = { day: Number(form.hDay), month: Number(form.hMonth), year: Number(form.hYear) };
    else recurrence.startDate = form.date;
    return {
      title: form.title, departmentId: form.departmentId, venueId: form.venueId, audience: form.audience,
      contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
      notes: form.notes, visibility: form.visibility, status: rep.status, timeMode: form.timeMode, recurrence,
      ...programPayload()
    };
  }

  // Two-step: first preview the exact occurrences (and conflicts), then create on confirmation.
  async function handleRecurringCreate(confirmed) {
    if (!form.title || !form.departmentId || !form.venueId || !form.start || !form.end || !form.contactName || !form.contactEmail) {
      setErr('Please fill in title, booking type, venue, times and contact details.'); return;
    }
    if (!form.endNextDay && form.end <= form.start) { setErr('End time must be after start time.'); return; }
    setBusy(true);
    try {
      if (!confirmed) {
        setPreview(await previewRecurringBooking(seriesPayload()));
        return;
      }
      const res = await createRecurringBooking(seriesPayload());
      setOk(`Created ${res.created} occurrence(s) as ${res.status}.` +
        (res.conflicts ? ` ${res.conflicts} overlap another booking at this venue and are flagged for review.` : ''));
      setPreview(null);
      setLocked(true);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not create the recurring booking.');
    } finally { setBusy(false); }
  }

  function requestDelete() {
    if (isSeries) { setDeletePrompt(true); return; }
    if (!window.confirm('Permanently delete this booking? This cannot be undone.')) return;
    handleDelete('single');
  }

  async function handleDelete(deleteScope) {
    setDeletePrompt(false);
    setErr(''); setOk(''); setBusy(true);
    try {
      const res = await deleteBooking(editing.id, isSeries ? deleteScope : 'single');
      setOk(`Deleted ${res.deleted} booking(s).${res.kept ? ` ${res.kept} past occurrence(s) kept.` : ''}`);
      onSaved && onSaved();
      onClose && onClose();
    } catch (e2) {
      setErr(e2?.message || 'Could not delete.');
    } finally { setBusy(false); }
  }

  async function handlePublicSubmit(e) {
    e.preventDefault();
    setErr(''); setOk('');
    if (isAdmin && rep.on) { await handleRecurringCreate(false); return; }
    if (!form.title || !form.departmentId || !form.venueId || !gregorianDate || !form.start || !form.end) {
      setErr('Please fill in title, booking type, venue, date and times.'); return;
    }
    if (!range || new Date(range.endAt) <= new Date(range.startAt)) { setErr('End time must be after start time.'); return; }
    const { startAt, endAt } = range;
    if (!isAdmin && new Date(startAt).getTime() < earliestAllowedPublicStart()) {
      setErr(`Public bookings must start at least ${MIN_PUBLIC_LEAD_HOURS} hours from now. Please choose a later time.`);
      return;
    }
    if (needsVerification && (!bookingVerification?.verified || bookingVerification.expiresAt<=Date.now())) {
      setErr('Verify your selected email or mobile number before submitting the booking.');
      return;
    }
    setBusy(true);
    try {
      const payload = !needsVerification ? publicBookingPayload() : {
        ...publicBookingPayload(),
        verificationChallengeId: bookingVerification.challengeId,
        verificationSessionId: verificationSessionId.current
      };
      const res = await submitBooking(payload);
      setOk(res?.status==='confirmed'?'Booking confirmed. No further approval is required.':res?.hasConflict
        ? 'Request submitted as Pending. Note: it overlaps another booking at this venue — the admin team will review it.'
        : 'Request submitted as Pending. You will be notified once it is reviewed.');
      setLocked(true);
      onSaved && onSaved();
    } catch (e2) {
      if(needsVerification && /verification|verify|contact changed/i.test(e2?.message||'')){setBookingVerification(null);setVerificationCode('');}
      setErr(e2?.message || 'Could not submit the booking. Please try again.');
    } finally { setBusy(false); }
  }

  async function handleAdminSave(e) {
    e.preventDefault();
    if (busy || locked) return;
    setErr(''); setOk('');
    setBusy(true);
    try {
      if (!range || new Date(range.endAt) <= new Date(range.startAt)) { setErr('End time must be after start time.'); setBusy(false); return; }
      const patch = adminPatch();
      const result = await updateBookingScoped(editing.id, patch, isSeries ? scope : 'single');
      const updated = bookingWithPatch(patch, result);
      setSavedBooking(updated);
      setForm(emptyForm(updated, initialDate, isAdmin));
      setOk('Booking updated.');
      setLocked(true);
      setEditMode(false);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not save changes.');
    } finally { setBusy(false); }
  }

  async function decide(status) {
    if (busy || locked) return;
    setErr(''); setOk('');
    setBusy(true);
    try {
      let current = editing;
      const baseline = emptyForm(editing, initialDate, isAdmin);
      const detailsChanged = Object.keys(form).some(k => k !== 'decisionNote' && form[k] !== baseline[k]);
      if (detailsChanged) {
        if (!range || new Date(range.endAt) <= new Date(range.startAt)) {
          setErr('End time must be after start time.');
          return;
        }
        const patch = adminPatch();
        const saved = await updateBookingScoped(editing.id, patch, isSeries ? scope : 'single');
        current = bookingWithPatch(patch, saved);
        setSavedBooking(current);
      }
      const result = await decideBooking({
        eventId: editing.id, status,
        visibility: form.visibility,
        note: form.decisionNote || ''
      });
      const updated = {
        ...current, status: result.status, visibility: form.visibility,
        decisionNote: form.decisionNote || '', hasConflict: result.hasConflict
      };
      setSavedBooking(updated);
      setForm(emptyForm(updated, initialDate, isAdmin));
      setLocked(true);
      setEditMode(false);
      setOk(status === 'confirmed' ? 'Booking approved. This booking is now confirmed.' : `Booking ${status}.`);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not update status.');
    } finally { setBusy(false); }
  }

  const repeating = isAdmin && !editing && rep.on;

  function adminPatch() {
    return {
      timeMode: form.timeMode,
      title: form.title, departmentId: form.departmentId, venueId: form.venueId, audience: form.audience,
      ...range, notes: form.notes,
      contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
      visibility: form.visibility,
      ...programPayload()
    };
  }

  function bookingWithPatch(patch, result) {
    const moved = dateKeyInOrgTz(patch.startAt) !== dateKeyInOrgTz(editing.startAt);
    return {
      ...editing, ...patch,
      departmentName: departments.find(d => d.id === patch.departmentId)?.name || editing.departmentName,
      venueName: venues.find(v => v.id === patch.venueId)?.name || editing.venueName,
      hijri: getHijriParts(dateKeyInOrgTz(patch.startAt), hijriOverrides),
      ...(moved ? { dateBasis: 'gregorian', hijriDate: null } : {}),
      hasConflict: result.hasConflict
    };
  }

  return (
    <div className="overlay show" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title" onClick={e => e.stopPropagation()}>
        {closeButton}
        <h3 id="booking-modal-title" style={{ marginTop: 0, paddingRight: 36 }}>{editing ? 'Edit booking' : 'New booking request'}</h3>

        <form onSubmit={isAdmin && editing ? handleAdminSave : handlePublicSubmit}>
          <fieldset className="dlg-fields" disabled={readOnly || busy}>
            <label htmlFor="booking-audience">Programme audience</label>
            <select id="booking-audience" value={form.audience} onChange={e => set('audience', e.target.value)} required>{Object.entries(AUDIENCES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
            <label>Title</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} required />

            <div className="r2">
              <div>
                <label htmlFor="booking-type">Booking type</label>
                <select id="booking-type" value={form.departmentId} onChange={e => setBookingType(e.target.value)} required>
                  <option value="">Select…</option>
                  {bookingTypes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label>Venue</label>
                <select value={form.venueId} onChange={e => set('venueId', e.target.value)} required>
                  <option value="">Select…</option>
                  {venues.map(v => <option key={v.id} value={v.id} disabled={!!audienceError(v,form.audience)}>{v.name}{audienceError(v,form.audience) ? " — Ladies only" : ""}</option>)}
                </select>
              </div>
            </div>

            {!editing && (
              <>
                <label>Date based on</label>
                <select value={form.basis} onChange={e => switchBasis(e.target.value)}>
                  <option value="g">Gregorian</option>
                  <option value="h">Hijri (Islamic)</option>
                </select>
              </>
            )}

            {form.basis === 'g' || editing ? (
              <>
                <label>{repeating ? 'First date' : 'Date'}</label>
                <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
                {hijriPreview && <div className="muted">≈ {hijriPreview} (moon-sighting adjustment applied)</div>}
                {editing && editing.dateBasis === 'hijri' && (
                  <div className="muted">
                    This booking is anchored to its Hijri date — its Gregorian date is recomputed automatically if the moon-sighting adjustment changes. Changing the date here will detach it and fix it to this Gregorian date instead.
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px', gap: 10 }}>
                <div><label>Day</label><input type="number" min="1" max="30" value={form.hDay} onChange={e => set('hDay', e.target.value)} /></div>
                <div>
                  <label>Month</label>
                  <select value={form.hMonth} onChange={e => set('hMonth', e.target.value)}>
                    {HIJRI_MONTHS.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
                  </select>
                </div>
                <div><label>Year (AH)</label><input type="number" value={form.hYear} onChange={e => set('hYear', e.target.value)} /></div>
              </div>
            )}
            {form.basis === 'h' && !editing && (
              <div className="muted">
                {gregorianDate ? `= ${formatInOrgTz(localToUtcIso(gregorianDate, '12:00'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : 'Not a valid Hijri date'}
              </div>
            )}

            {!isAdmin && protectionWarning && <div className="conflict-warn" role="status">{protectionWarning}</div>}

            <div role="radiogroup" aria-label="Time of day" className="timemode">
              {[['custom', 'Set times'], ['allDay', 'All day (00:00–23:59)'], ['allNight', 'All night (18:00–06:00 next day)']].map(([v, label]) => (
                <label key={v} className="radio">
                  <input type="radio" name="timeMode" checked={form.timeMode === v} onChange={() => setTimeMode(v)} /> {label}
                </label>
              ))}
            </div>
            <div className="r2">
              {[['start', 'Start', startVariable], ['end', `End${form.endNextDay ? ' (next day)' : ''}`, endVariable]].map(([side, label, variable]) => (
                <div key={side}>
                  <label>{label}</label>
                  {isProgram && form.timeMode === 'custom' && (
                    <div className="seg" role="radiogroup" aria-label={`${side} time type`}>
                      <button type="button" className={`seg-btn${!variable ? ' on' : ''}`} aria-pressed={!variable} onClick={() => setKind(side, 'fixed')}>Fixed time</button>
                      <button type="button" className={`seg-btn${variable ? ' on' : ''}`} aria-pressed={variable} onClick={() => setKind(side, 'variable')}>Prayer time (variable)</button>
                    </div>
                  )}
                  {variable ? (
                    <div className="prayer-pick">
                      <select aria-label={`${side} prayer`} value={form[`${side}PrayerKey`]} onChange={e => set(`${side}PrayerKey`, e.target.value)}>
                        {PRAYER_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                      <div className="offset">
                        <button type="button" className="btn sm" aria-label="30 minutes earlier"
                          onClick={() => set(`${side}Offset`, Math.max(-MAX_OFFSET_MINUTES, (Number(form[`${side}Offset`]) || 0) - 30))}>−30</button>
                        <input type="number" step="5" min={-MAX_OFFSET_MINUTES} max={MAX_OFFSET_MINUTES} aria-label={`${side} offset in minutes`}
                          value={form[`${side}Offset`]} onChange={e => set(`${side}Offset`, e.target.value)} />
                        <button type="button" className="btn sm" aria-label="30 minutes later"
                          onClick={() => set(`${side}Offset`, Math.min(MAX_OFFSET_MINUTES, (Number(form[`${side}Offset`]) || 0) + 30))}>+30</button>
                        <span className="muted">min</span>
                      </div>
                      <div className="muted">
                        {prayerTimesToday
                          ? <>Prayer: {side === 'end' && form.endNextDay
                              ? calculatePrayerTimes(addDays(gregorianDate, 1))?.[form.endPrayerKey]
                              : prayerTimesToday[form[`${side}PrayerKey`]]} · Event {side}: <b>{form[side]}</b>{side === 'end' && form.endNextDay ? ' (next day)' : ''}</>
                          : 'Choose a date to calculate the prayer time.'}
                      </div>
                    </div>
                  ) : (
                    <input type="time" aria-label={`${side} time`} value={form[side]} disabled={form.timeMode !== 'custom'} onChange={e => set(side, e.target.value)} required />
                  )}
                </div>
              ))}
            </div>
            {(startVariable || endVariable) && (
              <div className="muted">Prayer times are calculated for Muhammadi Welfare Association, 81-89 Clifton Avenue, Kemps Creek NSW (Jafari method) and follow the booking's date.</div>
            )}

            {isProgram && (
              <>
                <label>Speaker name (optional)</label>
                <input value={form.speakerName} maxLength={200} onChange={e => set('speakerName', e.target.value)} />
                <label>Program details (optional)</label>
                <textarea rows={3} maxLength={2000} value={form.programDetails} onChange={e => set('programDetails', e.target.value)} />
              </>
            )}
            {watchConflicts && conflictErr && <div className="conflict-warn" role="alert">{conflictErr}</div>}
            {watchConflicts && conflict && conflict.hasConflict && (
              <div className="conflict-warn" role="alert">
                {isAdmin
                  ? <>
                      <b>This slot conflicts with {conflict.count} other booking(s) at this venue (including the venue's buffer after each booking):</b>
                      <ul>
                        {(conflict.conflicts || []).map(c2 => (
                          <li key={c2.id}>{c2.title}{c2.venueName ? ` @ ${c2.venueName}` : ''} — {c2.status} — {fmtRange(c2.startAt, c2.endAt)}{c2.departmentName ? ` — ${c2.departmentName}` : ''}{c2.contactName ? ` — ${c2.contactName}` : ''}</li>
                        ))}
                      </ul>
                      You can still save: accept the overlap, change the time/venue, or reject.
                    </>
                  : 'This conflicts with another booking at this venue. You can still submit; the request is subject to admin approval.'}
              </div>
            )}
            {watchConflicts && conflict && !conflict.hasConflict && isAdmin && (
              <div className="ok" style={{ marginTop: 8 }}>No conflicts for this venue and time.</div>
            )}

            <div className="r2">
              <div><label>Contact name</label><input value={form.contactName} onChange={e => set('contactName', e.target.value)} required /></div>
              <div><label>Contact email</label><input type="email" readOnly={needsVerification&&bookingVerification?.verified&&verificationMethod==='email'} value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} required={isAdmin || (needsVerification && verificationMethod === 'email')} /></div>
            </div>
            <label>Contact phone{!isAdmin && verificationMethod === 'mobile' ? '' : ' (optional)'}</label>
            <input type="tel" readOnly={needsVerification&&bookingVerification?.verified&&verificationMethod==='mobile'} value={form.contactPhone} onChange={e => set('contactPhone', e.target.value)} required={!isAdmin && verificationMethod === 'mobile'} />
            {needsVerification&&<p className="muted">Contact verified. <button type="button" className="btn" onClick={()=>{setBookingVerification(null);setVerificationCode('');}}>Change verified contact</button></p>}
            <label>Notes (optional)</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />

            {/* Public submitters default to Public; admin-created bookings default to
                Private. Private and pending bookings appear publicly only as masked items. */}
            <label>Visibility</label>
            <select value={form.visibility} onChange={e => set('visibility', e.target.value)}>
              <option value="public">Public (title and details shown on the calendar)</option>
              <option value="private">Private (shown publicly only as “Private”)</option>
            </select>
            {!isAdmin && !editing && (
              <div className="muted">Your request appears on the calendar as “Unconfirmed booking” until an admin reviews it.</div>
            )}

            {isAdmin && !editing && (
              <div className="card" style={{ marginTop: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={rep.on} onChange={e => setR('on', e.target.checked)} />
                  Repeat this booking
                </label>
                {rep.on && (
                  <>
                    <div className="r2">
                      <div>
                        <label>Repeats</label>
                        <select value={rep.frequency} onChange={e => setR('frequency', e.target.value)}>
                          <option value="day">Daily</option>
                          <option value="week">Weekly</option>
                          <option value="month">Monthly</option>
                          <option value="year">Yearly</option>
                        </select>
                      </div>
                      <div>
                        <label>Every</label>
                        <input type="number" min="1" max="100" value={rep.repeatEvery} onChange={e => setR('repeatEvery', e.target.value)} />
                      </div>
                    </div>
                    <div className="r2">
                      <div>
                        <label>Ends</label>
                        <select value={rep.endMode} onChange={e => setR('endMode', e.target.value)}>
                          <option value="count">After a number of occurrences</option>
                          <option value="date">On a date</option>
                        </select>
                      </div>
                      <div>
                        {rep.endMode === 'count'
                          ? <><label>Occurrences</label><input type="number" min="1" max="370" value={rep.count} onChange={e => setR('count', e.target.value)} /></>
                          : <><label>End date</label><input type="date" value={rep.endDate} onChange={e => setR('endDate', e.target.value)} /></>}
                      </div>
                    </div>
                    <label>Create as</label>
                    <select value={rep.status} onChange={e => setR('status', e.target.value)}>
                      <option value="confirmed">Confirmed</option>

                    </select>
                    <div className="muted">Up to one year ahead (yearly: 5 occurrences). {form.basis === 'h' ? 'Hijri-anchored: each occurrence follows its Hijri date. ' : ''}Overlapping occurrences are created and flagged for review.</div>
                  </>
                )}
              </div>
            )}
          </fieldset>

          {isSeries && isAdmin && (
            <div className="card" style={{ marginTop: 14 }}>
              <b>Recurring series</b>{editing.seriesIndex ? ` — occurrence ${editing.seriesIndex} of ${editing.seriesCount}` : ''}
              <label>Apply edits to</label>
              <select value={scope} disabled={busy} onChange={e => setScope(e.target.value)}>
                <option value="single">This occurrence only</option>
                <option value="future">This and following occurrences</option>
                <option value="all">All occurrences</option>
              </select>
              {scope !== 'single' && <div className="muted">Edits to several occurrences apply shared fields and the time of day; dates can only be changed for a single occurrence.</div>}
            </div>
          )}

          {editing && extrasSummary}

          {editing && (
            <div className="card" style={{ marginTop: 14 }}>
              <div><b>Status:</b> <span className={`tag st-${editing.status}`}>{editing.status}</span>
                {editing.hasConflict && <span className="conflict-badge">Overlaps another booking at this venue</span>}
              </div>
              {isAdmin && editing.status === 'pending' && (
                <>
                  <label>Decision note (optional)</label>
                  <input disabled={busy} value={form.decisionNote} onChange={e => set('decisionNote', e.target.value)} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="btn pri" disabled={busy || locked} onClick={() => decide('confirmed')}>Approve</button>
                    <button type="button" className="btn del" disabled={busy || locked} onClick={() => decide('rejected')}>Reject</button>
                  </div>
                </>
              )}
              {isAdmin && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {editing.status !== 'cancelled' && (
                    <button type="button" className="btn del" disabled={busy || locked} onClick={() => decide('cancelled')}>Cancel booking</button>
                  )}
                  <button type="button" className="btn del" disabled={busy || locked} onClick={requestDelete}>Delete</button>
                </div>
              )}
            </div>
          )}

          {repeating && preview && (
            <div className="card" style={{ marginTop: 14 }}>
              <AdminBackButton disabled={busy} onBack={() => setPreview(null)}/>
              <b>This will create {preview.count} event(s)</b>
              {preview.conflicts > 0 && <span className="conflict-badge">{preview.conflicts} with conflicts</span>}
              <div className="muted">{form.basis === 'h' ? 'Hijri-anchored: Gregorian dates are derived from the Hijri dates and current adjustment.' : 'Gregorian-anchored: Hijri dates are derived from each Gregorian date.'}</div>
              <ol className="preview-list">
                {preview.occurrences.map(o => (
                  <li key={o.index} className={o.hasConflict ? 'has-conflict' : ''}>
                    {fmtRange(o.startAt, o.endAt)}{o.hijri ? ` · ${fmtHijri(o.hijri)}` : ''}
                    {o.hasConflict && <> — <b>conflict</b>: {o.conflicts.map(x => x.title).join(', ')}</>}
                  </li>
                ))}
              </ol>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn pri" disabled={busy || locked} onClick={() => handleRecurringCreate(true)}>Confirm &amp; create {preview.count} event(s)</button>

              </div>
            </div>
          )}

          {err && <div className="err">{err}</div>}
          {ok && <div className="ok">{ok}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {isAdmin && editing && editMode && (
              <>
                <button type="button" className="btn alt" disabled={busy||locked} onClick={()=>{setForm(current=>({...current,title:'',notes:'',speakerName:'',programDetails:''}));setErr('');}}>Clear</button><button className="btn pri" disabled={busy || locked} type="submit">Save changes</button>
                <button className="btn" disabled={busy} type="button" onClick={cancelEdit}>Cancel</button>
              </>
            )}
            {!editing && (
              <>
                <button className="btn pri" disabled={busy || locked || (repeating && !!preview) || (needsVerification && !bookingVerification?.verified)} type="submit">{repeating ? 'Preview series' : isAdmin?'Save confirmed booking':'Submit request'}</button>
                <button className="btn" disabled={busy} type="button" onClick={clearForm}>Clear form</button><button className="btn" disabled={busy} type="button" onClick={onClose}>Cancel</button>
              </>
            )}
          </div>
        </form>
      </div>
      {extrasEditor}
      {deletePrompt && (
        <SeriesDeletePrompt title={editing.title} onChoose={handleDelete} onCancel={() => setDeletePrompt(false)} />
      )}
    </div>
  );
}

const prayerForm = (p, side) => ({
  [`${side}Kind`]: p && p.key ? 'variable' : 'fixed',
  [`${side}PrayerKey`]: (p && p.key) || (side === 'start' ? 'maghreb' : 'isha'),
  [`${side}Offset`]: p && Number.isFinite(Number(p.offset)) ? Number(p.offset) : 0
});

function emptyForm(editing, initialDate, isAdmin) {
  if (editing) {
    const dateKey = editing.startAt ? dateKeyInOrgTz(editing.startAt) : todayStr();
    return {
      audience: editing.audience || 'family', title: editing.title || '', departmentId: editing.departmentId || '', venueId: editing.venueId || '',
      basis: 'g', date: dateKey,
      hDay: '', hMonth: '1', hYear: '',
      start: isoTime(editing.startAt), end: isoTime(editing.endAt),
      contactName: editing.contactName || '', contactEmail: editing.contactEmail || '', contactPhone: editing.contactPhone || '',
      notes: editing.notes || '',
      visibility: editing.visibility || 'private', decisionNote: '',
      timeMode: editing.timeMode || 'custom',
      endNextDay: !!(editing.startAt && editing.endAt && dateKeyInOrgTz(editing.endAt) !== dateKeyInOrgTz(editing.startAt)),
      speakerName: editing.speakerName || '', programDetails: editing.programDetails || '',
      ...prayerForm(editing.startPrayer, 'start'), ...prayerForm(editing.endPrayer, 'end')
    };
  }
  return {
    audience: 'family', title: '', departmentId: '', venueId: '', basis: 'g', date: initialDate || todayStr(),
    hDay: '', hMonth: '1', hYear: '',
    start: '09:00', end: '10:00',
    contactName: '', contactEmail: '', contactPhone: '', notes: '',
    visibility: isAdmin ? 'private' : 'public', decisionNote: '',
    timeMode: 'custom', endNextDay: false,
    speakerName: '', programDetails: '',
    ...prayerForm(null, 'start'), ...prayerForm(null, 'end')
  };
}

// Reads the org timezone's wall-clock time (never the browser's local zone).
function isoTime(iso) {
  if (!iso) return '09:00';
  return timeKeyInOrgTz(iso) || '09:00';
}

// Rendered on document.body so ancestors with backdrop-filter/transform (glass panels)
// can't become the containing block of the fixed overlay.
export default function BookingModal(props) {
  return createPortal(<BookingModalInner {...props} />, document.body);
}
