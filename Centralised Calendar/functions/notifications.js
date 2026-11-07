// Email notification content and recipients (see docs/NOTIFICATIONS.md for the approved matrix).
// Pure, dependency-free builders so every message can be unit tested; sending happens in mailer.js.
// Admin mail never goes to the public; requester mail never reveals other bookings or admin-only data.
const { prayerLabel } = require('./prayerTimes');

const ORG_TZ = 'Australia/Sydney';
const ORG_NAME = 'Muhammadi Welfare Association';
const SITE_URL = 'https://refreshed.muhammadiwelfare.org.au/calendar/';
const ADMIN_TO = 'Events@muhammadiwelfare.org.au';
const ADMIN_CC = 'admin@muhammadiwelfare.org.au';
const REPLY_TO = 'Events@muhammadiwelfare.org.au';
const GREEN = '#1c8f45';

const HIJRI_NAMES = ['', 'Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah',
  'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah'];

const adminRecipients = () => ({ to: ADMIN_TO, cc: ADMIN_CC });

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-AU', { timeZone: ORG_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-AU', { timeZone: ORG_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, ' $1m');
}
function hijriText(h) {
  return h && h.year ? `${h.day} ${HIJRI_NAMES[h.month] || h.monthName || ''} ${h.year} AH` : '';
}

function timeText(e) {
  if (e.timeMode === 'allDay') return 'All day';
  if (e.timeMode === 'allNight') return `All night (from ${fmtTime(e.startAt)})`;
  const start = `${fmtTime(e.startAt)}${e.startPrayer ? ` (${prayerLabel(e.startPrayer)})` : ''}`;
  const end = `${fmtTime(e.endAt)}${e.endPrayer ? ` (${prayerLabel(e.endPrayer)})` : ''}`;
  return `${start} \u2013 ${end}`;
}

/** Ordered [label, value] rows describing a booking. `forAdmin` adds contact details and notes. */
function detailRows(e, hijri, { forAdmin = false } = {}) {
  const rows = [
    ['Event', e.title],
    ['Date', fmtDate(e.startAt)],
    ['Islamic date', hijriText(hijri)],
    ['Time', timeText(e)],
    ['Venue', e.venueName],
    ['Booking type', e.departmentName],
    ['Speaker', e.speakerName],
    ['Program details', e.programDetails]
  ];
  if (forAdmin) {
    rows.push(['Contact', [e.contactName, e.contactEmail, e.contactPhone].filter(Boolean).join(' \u00b7 ')]);
    rows.push(['Notes', e.notes]);
  }
  return rows.filter(([, v]) => v);
}

function render({ heading, intro, rows = [], extra = [], footerNote = '', actions = null }) {
  const text = [
    heading, '', intro, '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(extra.length ? ['', ...extra] : []),
    ...(actions?['',actions.approve?'Approve request: '+actions.approve:'Approve unavailable: this request has a conflict.','Reject request: '+actions.reject,'Open the link and confirm your decision. New email links require no sign-in and expire after 48 hours.']:[]),
    '', footerNote || `Live calendar: ${SITE_URL}`,
    '', ORG_NAME, '81-89 Clifton Avenue, Kemps Creek NSW 2178'
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Segoe UI,Arial,sans-serif;color:#1d1d1b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:20px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:${GREEN};color:#fff;padding:16px 24px;font-weight:800;font-size:16px;letter-spacing:.5px">MUHAMMADI WELFARE ASSOCIATION<br><span style="font-size:13px">EVENTS CALENDAR</span></td></tr>
<tr><td style="padding:22px 24px 8px"><h2 style="margin:0 0 10px;font-size:20px;color:${GREEN}">${esc(heading)}</h2><p style="margin:0 0 14px;line-height:1.5">${esc(intro)}</p>
${rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#555;white-space:nowrap;vertical-align:top;border-bottom:1px solid #e3efe7">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #e3efe7;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>` : ''}
${extra.map(l => `<p style="margin:12px 0 0;line-height:1.5">${esc(l)}</p>`).join('')}
${actions?`<p style="margin:22px 0 12px">${actions.approve?`<a href="${esc(actions.approve)}" style="display:inline-block;background:#176446;color:white;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">Approve request</a>`:`<span aria-disabled="true" style="display:inline-block;background:#e6e8e7;color:#69736d;padding:12px 20px;border-radius:6px">Approve unavailable — conflict</span>`} &nbsp; <a href="${esc(actions.reject)}" style="display:inline-block;background:#fff;color:#813e3e;border:1px solid #c9b3b3;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">Reject request</a></p><p style="font-size:12px;color:#666;line-height:1.5">Open the link and confirm your decision. New email links require no sign-in, expire after 48 hours and work once. Availability is checked again before approval.</p>`:''}

</td></tr>
<tr><td style="padding:18px 24px 22px;font-size:12px;color:#6d6d6d;border-top:2px solid ${GREEN}">${esc(footerNote || 'Program dates may change based on moonsighting. Please check the live calendar at')} <a href="${SITE_URL}" style="color:${GREEN};font-weight:700">Open MWA calendar</a><br>${ORG_NAME} \u00b7 81-89 Clifton Avenue, Kemps Creek NSW 2178</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

function mail(to, subject, body, extra = {}) {
  return { to, subject, ...body, ...extra };
}

// ── Row 1 + 2: submission ────────────────────────────────────────────────
function submissionRequester(e, hijri) {
  return mail(e.contactEmail, `Booking request received: ${e.title}`, render({
    heading: 'Booking request received',
    intro: `Thank you, ${e.contactName || 'there'}. Your request has been received and is Pending review. We will email you once our team has reviewed it.`,
    rows: detailRows(e, hijri)
  }));
}

function submissionAdmin(e, hijri, overlaps = []) {
  const extra = overlaps.length
    ? ['\u26A0 This request overlaps existing booking(s):', ...overlaps.map(o => `\u2022 ${o.title || 'Untitled'} \u2013 ${fmtDate(o.startAt)}, ${fmtTime(o.startAt)}\u2013${fmtTime(o.endAt)} (${o.status}${o.venueName ? `, ${o.venueName}` : ''})`)]
    : [];
  const blocked=overlaps.length>0||e.hasConflict===true;
  if(blocked&&!overlaps.length)extra.push('This request has a conflict. Approval from this email is unavailable.');
  const actionUrl=decision=>e.emailActions?.[decision]||SITE_URL+'?booking='+encodeURIComponent(e.id)+'&decision='+decision;
  const actions=e.id?{approve:blocked?null:actionUrl('approve'),reject:actionUrl('reject')}:null;
  extra.push(`Review it in the admin calendar: ${SITE_URL}`);
  return mail(ADMIN_TO, `${overlaps.length ? '\u26A0 Overlap \u2013 ' : ''}New booking request: ${e.title}`, render({
    heading: overlaps.length ? 'New booking request (overlap flagged)' : 'New booking request',
    intro: 'A new booking request is waiting for review.',
    rows: detailRows(e, hijri, { forAdmin: true }), extra, actions
  }), { cc: ADMIN_CC });
}

// ── Rows 3–5: decisions ──────────────────────────────────────────────────
const DECISION = {
  confirmed: { subject: 'Booking confirmed', heading: 'Your booking is confirmed', intro: 'Good news \u2013 your booking has been confirmed. A calendar file is attached.' },
  rejected: { subject: 'Booking declined', heading: 'Your booking request was declined', intro: 'Unfortunately we are unable to accept this booking request.' },
  cancelled: { subject: 'Booking cancelled', heading: 'Your booking has been cancelled', intro: 'This booking has been cancelled.' }
};

function decisionRequester(e, hijri, status, note) {
  const d = DECISION[status];
  if (!d || !e.contactEmail) return null;
  return mail(e.contactEmail, `${d.subject}: ${e.title}`, render({
    heading: d.heading, intro: d.intro, rows: detailRows(e, hijri),
    extra: [note ? `Note from the team: ${note}` : '', status !== 'confirmed' ? `Questions? Reply to this email or contact ${REPLY_TO}.` : ''].filter(Boolean)
  }));
}

function cancellationAdmin(e, hijri, adminEmail, note) {
  return mail(ADMIN_TO, `Booking cancelled: ${e.title}`, render({
    heading: 'Booking cancelled', intro: `Cancelled by ${adminEmail || 'an admin'}.`,
    rows: detailRows(e, hijri, { forAdmin: true }), extra: note ? [`Note: ${note}`] : []
  }), { cc: ADMIN_CC });
}

// ── Row 6: date / time / venue changed on a confirmed booking ────────────
function scheduleChanged(before, after) {
  return before.startAt !== after.startAt || before.endAt !== after.endAt || before.venueId !== after.venueId;
}

function updateRequester(e, hijri, { previous, occurrences = 1 } = {}) {
  if (!e.contactEmail) return null;
  const extra = [];
  if (previous) extra.push(`Previously: ${fmtDate(previous.startAt)}, ${fmtTime(previous.startAt)} \u2013 ${fmtTime(previous.endAt)}${previous.venueName ? ` at ${previous.venueName}` : ''}.`);
  if (occurrences > 1) extra.push(`This change applies to ${occurrences} upcoming occurrences of this recurring booking.`);
  return mail(e.contactEmail, `Booking updated: ${e.title}`, render({
    heading: 'Your booking has been updated', intro: 'The date, time or venue of your booking has changed. The new details are below.',
    rows: detailRows(e, hijri), extra
  }));
}

// ── Row 7: delete (confirmed bookings only) ─────────────────────────────
function deletionRequester(e, hijri, count = 1) {
  if (!e.contactEmail) return null;
  return mail(e.contactEmail, `Booking cancelled: ${e.title}`, render({
    heading: 'Your booking has been cancelled',
    intro: count > 1 ? `${count} upcoming occurrences of this booking have been removed from the calendar.` : 'This booking has been removed from the calendar.',
    rows: detailRows(e, hijri), extra: [`Questions? Reply to this email or contact ${REPLY_TO}.`]
  }));
}

// ── Row 8: admin-created series (one summary email) ─────────────────────
function seriesCreatedRequester(e, hijri, { count, lastStartAt, status }) {
  if (!e.contactEmail) return null;
  return mail(e.contactEmail, `Booking ${status === 'confirmed' ? 'confirmed' : 'created'}: ${e.title}`, render({
    heading: status === 'confirmed' ? 'Your recurring booking is confirmed' : 'Your recurring booking has been created',
    intro: `${count} occurrence(s) have been added to the calendar${count > 1 ? `, from ${fmtDate(e.startAt)} to ${fmtDate(lastStartAt)}` : ''}. The first one is shown below.`,
    rows: detailRows(e, hijri)
  }));
}

// ── Row 11: date moved after a moon-sighting adjustment ─────────────────
function moonSightingRequester(e, hijri, previous) {
  if (!e.contactEmail) return null;
  return mail(e.contactEmail, `Date changed after moon sighting: ${e.title}`, render({
    heading: 'Your booking date has changed',
    intro: 'Following the latest moon sighting, the Islamic calendar was adjusted. Your booking keeps its Islamic date, so its calendar date has moved.',
    rows: detailRows(e, hijri), extra: [`Previously: ${fmtDate(previous.startAt)}.`]
  }));
}

function moonSightingAdmin(changes) {
  return mail(ADMIN_TO, `Moon-sighting adjustment moved ${changes.length} booking(s)`, render({
    heading: 'Bookings moved after moon-sighting adjustment',
    intro: `${changes.length} booking(s) anchored to an Islamic date moved to a different calendar date.`,
    extra: changes.slice(0, 100).map(c => `\u2022 ${c.title || 'Untitled'}: ${fmtDate(c.fromStartAt)} \u2192 ${fmtDate(c.toStartAt)}${c.status === 'pending' ? ' (pending)' : ''}`)
      .concat(changes.length > 100 ? [`\u2026 and ${changes.length - 100} more.`] : [])
  }), { cc: ADMIN_CC });
}

// ── Row 12: reminder 2 days before ──────────────────────────────────────
function reminderRequester(e, hijri) {
  if (!e.contactEmail) return null;
  return mail(e.contactEmail, `Reminder: ${e.title} on ${fmtDate(e.startAt)}`, render({
    heading: 'Booking reminder', intro: 'This is a friendly reminder of your upcoming booking.', rows: detailRows(e, hijri)
  }));
}

// ── Row 13: daily pending digest ────────────────────────────────────────
function pendingDigestAdmin(pending) {
  if (!pending.length) return null;
  const sorted = pending.slice().sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  return mail(ADMIN_TO, `${pending.length} booking request(s) awaiting review`, render({
    heading: 'Pending booking requests',
    intro: `${pending.length} request(s) are waiting for a decision.`,
    extra: sorted.slice(0, 100).map(e => `\u2022 ${e.title || 'Untitled'} \u2013 ${fmtDate(e.startAt)}, ${fmtTime(e.startAt)}${e.venueName ? ` \u00b7 ${e.venueName}` : ''}${e.hasConflict ? ' \u00b7 \u26A0 overlap' : ''}`)
      .concat(sorted.length > 100 ? [`\u2026 and ${sorted.length - 100} more.`] : [], [`Review them in the admin calendar: ${SITE_URL}`])
  }), { cc: ADMIN_CC });
}

/** Sydney civil date 'YYYY-MM-DD' `days` after `now`. */
function sydneyDateKey(now, days = 0) {
  return new Date(now.getTime() + days * 86400000).toLocaleDateString('en-CA', { timeZone: ORG_TZ });
}

/** Single-event .ics attachment for a confirmed booking. */
function icsAttachment(e, id) {
  const z = v => new Date(v).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escI = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MWA Central Calendar//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${id}@eventscalendar.muhammadiwelfare.org.au`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(e.startAt)}`, `DTEND:${z(e.endAt)}`,
    `SUMMARY:${escI(e.title)}`, `LOCATION:${escI([e.venueName, '81-89 Clifton Avenue, Kemps Creek NSW 2178'].filter(Boolean).join(', '))}`,
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return { filename: 'booking.ics', content, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' };
}

function verificationCode(to,code){
  if(!/^\d{6}$/.test(code))throw new Error('Invalid verification code.');
  return mail(to,'Your MWA Booking Verification Code',render({heading:'Booking Verification',intro:'Verify your contact before entering your booking details.',rows:[['Verification code',code]],extra:['This code expires in 10 minutes. Enter it only on the MWA website.','This does not submit or approve a booking. If you did not request this code, ignore this email.']}));
}

module.exports = {
  verificationCode,
  ADMIN_TO, ADMIN_CC, REPLY_TO, SITE_URL, adminRecipients,
  submissionRequester, submissionAdmin, decisionRequester, cancellationAdmin,
  scheduleChanged, updateRequester, deletionRequester, seriesCreatedRequester,
  moonSightingRequester, moonSightingAdmin, reminderRequester, pendingDigestAdmin,
  sydneyDateKey, icsAttachment, detailRows, timeText
};
