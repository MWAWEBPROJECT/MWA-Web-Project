import {fetchPublicEvents} from '../services/eventsService.js';
import {recordActivity} from '../services/auditService.js';
import {bookingTypeStyle} from '@mwa/appearance';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildPdfModel, buildYearPdfModel, GREGORIAN_MONTH_NAMES, PDF_HIJRI_MONTH_OPTIONS } from '../services/pdfModel.js';

const PUBLIC_DEPARTMENT_NAME = 'MWA Programs';

export default function PdfExportModal({ events, venues, departments, isAdmin, overrides, initial, onClose }) {
  const [period, setPeriod] = useState('month');
  const [basis, setBasis] = useState(initial.basis);
  const [gYear, setGYear] = useState(initial.gCursor.year);
  const [gMonth, setGMonth] = useState(initial.gCursor.month);
  const [hYear, setHYear] = useState(initial.hCursor.hYear);
  const [hMonth, setHMonth] = useState(initial.hCursor.hMonth);
  // Public visitors can only print the MWA Programs calendar, across all venues.
  const publicDept = useMemo(() => departments.find(d => d.name.trim().toLowerCase() === PUBLIC_DEPARTMENT_NAME.toLowerCase()), [departments]);
  const [deptIds, setDeptIds] = useState(() => (isAdmin ? new Set(initial.deptFilter) : new Set(publicDept ? [publicDept.id] : [])));
  const [venueId, setVenueId] = useState(isAdmin ? (initial.venueFilter || '') : '');
  const [includePending, setIncludePending] = useState(false);
  const [publicOnly, setPublicOnly] = useState(true);
  const [template, setTemplate] = useState('classic');
  const [paperSize,setPaperSize]=useState('a4');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const yearOk = basis === 'gregorian' ? gYear >= 1900 && gYear <= 2200 : hYear >= 1300 && hYear <= 1600;
  const isYear = period === 'year';

  const filtered = useMemo(() => events.filter(e =>
    !e.masked &&
    (e.status === 'confirmed' || (isAdmin && includePending && e.status === 'pending')) &&
    (!isAdmin || !publicOnly || e.visibility === 'public' || e.departmentId === publicDept?.id) &&
    (isAdmin ? (!e.departmentId || deptIds.has(e.departmentId)) : (!!publicDept && e.departmentId === publicDept.id)) &&
    (!isAdmin || !venueId || e.venueId === venueId)
  ), [events, isAdmin, includePending, publicOnly, deptIds, venueId, publicDept]);

  // The full-year sheet always lists confirmed MWA Programs at every venue, for admins and visitors alike.
  const yearEvents = useMemo(() => events.filter(e =>
    !e.masked && e.status === 'confirmed' && !!publicDept && e.departmentId === publicDept.id
  ), [events, publicDept]);

  const model = useMemo(() => {
    if (!yearOk) return null;
    try {
      if (isYear) return buildYearPdfModel({ events: yearEvents, basis, year: gYear, hYear, overrides });
      return buildPdfModel({ events: filtered, basis, year: gYear, month: gMonth, hYear, hMonth, overrides });
    } catch { return null; }
  }, [filtered, yearEvents, isYear, basis, gYear, gMonth, hYear, hMonth, overrides, yearOk]);

  function toggleDept(id) {
    setDeptIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function download() {
    if (!model) return;
    setBusy(true); setErr('');
    try {
      let output=model;
      if(!isAdmin){
        const keys=(isYear?model.months.flatMap(m=>m.weeks.flat()):model.sheet.weeks.flat()).filter(Boolean).map(c=>c.key).sort();
        if(!keys.length)throw Error('The selected calendar period is unavailable.');
        const fresh=(await fetchPublicEvents({from:keys[0]+'T00:00:00+11:00',to:keys.at(-1)+'T23:59:59+10:00'})).filter(e=>!e.masked&&e.status==='confirmed'&&e.departmentId===publicDept?.id);
        output=isYear?buildYearPdfModel({events:fresh,basis,year:gYear,hYear,overrides}):buildPdfModel({events:fresh,basis,year:gYear,month:gMonth,hYear,hMonth,overrides});
      }
      if (isYear) {
        const { renderYearCalendarPdf, yearPdfFilename } = await import('../services/pdfYearCalendar.js');
        await renderYearCalendarPdf(output, yearPdfFilename(output), {template,paperSize,departments});
        if(isAdmin)recordActivity('events-bookings','calendar.exported',`annual-${basis}-${template}-${paperSize}`);
        onClose();
        return;
      }
      const { renderCalendarPdf, pdfFilename } = await import('../services/pdfCalendar.js');
      const noteLines = isAdmin ? notes.split(/\r?\n/).map(s => s.replace(/^\s*\*\s*/, '').trim()).filter(Boolean) : [];
      await renderCalendarPdf(output, pdfFilename(output), { template: isAdmin ? template : 'classic', notes: noteLines, paperSize,departments });
      if(isAdmin)recordActivity('events-bookings','calendar.exported',`monthly-${basis}-${template}-${paperSize}`);
      onClose();
    } catch (e) {
      setErr(`Couldn't create the PDF: ${e.message || e}`);
    } finally { setBusy(false); }
  }

  return createPortal(
    <div className="overlay show" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="pdf-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="dlg-close" onClick={onClose} aria-label="Close dialog">✕</button>
        <h3 id="pdf-title" style={{ paddingRight: 36 }}>Download calendar (PDF)</h3>

        <label>Calendar period</label>
        <div className="segmented" role="group" aria-label="Calendar period" style={{ marginBottom: 8 }}>
          {[['month', 'Month'], ['year', 'Full year']].map(([k, n]) => (
            <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}>{n}</button>
          ))}
        </div>

        {isYear && (<>
          <label>Calendar year</label>
          <div className="segmented" role="group" aria-label="Year basis" style={{ marginBottom: 8 }}>
            {['gregorian', 'hijri'].map(b => (
              <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}>{b === 'hijri' ? 'Hijri year' : 'Gregorian year'}</button>
            ))}
          </div>
          {basis === 'gregorian'
            ? <input aria-label="Year" type="number" value={gYear} onChange={e => setGYear(+e.target.value)} />
            : <input aria-label="Hijri year" type="number" value={hYear} onChange={e => setHYear(+e.target.value)} />}
          {!yearOk && <div className="err" role="alert">Enter a valid year.</div>}
          <p className="muted" style={{ marginTop: 10 }}>
            {basis === 'gregorian'
              ? `January – December ${gYear}${model?.subtitle ? ` (${model.subtitle})` : ''}`
              : `Muharram – Dhul Hijjah ${hYear}${model?.subtitle ? ` (${model.subtitle})` : ''}`}: an annual overview with confirmed {PUBLIC_DEPARTMENT_NAME} at all venues highlighted. Extra programme pages are added only when needed.
          </p>
        </>)}

        {!isYear && (<>
        <label>Calendar month</label>
        <div className="segmented" role="group" aria-label="Month basis" style={{ marginBottom: 8 }}>
          {['gregorian', 'hijri'].map(b => (
            <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}>{b === 'hijri' ? 'Hijri month' : 'Gregorian month'}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {basis === 'gregorian' ? (
            <>
              <select aria-label="Month" value={gMonth} onChange={e => setGMonth(+e.target.value)} style={{ flex: 2 }}>
                {GREGORIAN_MONTH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
              <input aria-label="Year" type="number" value={gYear} onChange={e => setGYear(+e.target.value)} style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <select aria-label="Hijri month" value={hMonth} onChange={e => setHMonth(+e.target.value)} style={{ flex: 2 }}>
                {PDF_HIJRI_MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
              </select>
              <input aria-label="Hijri year" type="number" value={hYear} onChange={e => setHYear(+e.target.value)} style={{ flex: 1 }} />
            </>
          )}
        </div>
        {!yearOk && <div className="err" role="alert">Enter a valid year.</div>}

        {isAdmin && (<>
        <label style={{ marginTop: 12 }}>Booking types</label>
        <div className="dept-chips" style={{ margin: '4px 0 8px' }}>
          {departments.map(d => (
            <button key={d.id} type="button" className="chip" onClick={() => toggleDept(d.id)}
              style={bookingTypeStyle(d,deptIds.has(d.id))}>{d.name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button type="button" className="btn" onClick={() => setDeptIds(new Set(departments.map(d => d.id)))}>All</button>
          <button type="button" className="btn" onClick={() => setDeptIds(new Set())}>None</button>
        </div>

        <label>Venue</label>
        <select value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Venue">
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        </>)}
        {!isAdmin && <p className="muted" style={{ marginTop: 12 }}>This calendar lists confirmed {PUBLIC_DEPARTMENT_NAME} events at all venues.</p>}

        {isAdmin && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={publicOnly} onChange={e => setPublicOnly(e.target.checked)} style={{ width: 'auto' }} /> Public events only (recommended for printing)
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={includePending} onChange={e => setIncludePending(e.target.checked)} style={{ width: 'auto' }} /> Include pending requests
            </label>
          </div>
        )}

        {isAdmin && (<>
          <label style={{ marginTop: 12 }}>PDF template</label>
          <div className="segmented" role="group" aria-label="PDF template" style={{ marginBottom: 8 }}>
            {[['classic', 'Classic'], ['decorative', 'Decorative']].map(([k, n]) => (
              <button key={k} type="button" aria-pressed={template === k} onClick={() => setTemplate(k)}>{n}</button>
            ))}
          </div>
          <label htmlFor="pdf-notes">Notes (optional, one per line, printed below the table)</label>
          <textarea id="pdf-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="For Niaz contact …" />
        </>)}

        <p className="muted" style={{ marginTop: 12 }}>
          {model ? `${model.eventCount} event(s) in ${model.footerLabel}. Only confirmed events are listed.` : 'Choose a month.'}
        </p>
        </>)}
        {isYear && model && <p className="muted">{model.eventCount} program(s) highlighted across 12 months.</p>}
        {isAdmin && isYear && <><label>PDF template</label><div className="segmented" role="group" aria-label="PDF template">{[['classic','Classic'],['decorative','Decorative']].map(([key,label])=><button key={key} type="button" aria-pressed={template===key} onClick={()=>setTemplate(key)}>{label}</button>)}</div></>}
        <label htmlFor="pdf-paper-size">Paper size</label><select id="pdf-paper-size" value={paperSize} onChange={e=>setPaperSize(e.target.value)}><option value="a4">A4 - standard</option><option value="a3">A3 - larger print</option></select>
        <p className="muted">Uses the website logo and your selected colour palette on a light background for printing.</p>
        {err && <div className="err" role="alert">{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn pri" disabled={busy || !model} onClick={download}>{busy ? 'Creating PDF…' : 'Download PDF'}</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
