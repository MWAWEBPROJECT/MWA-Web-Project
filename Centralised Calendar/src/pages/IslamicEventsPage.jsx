import { useEffect, useMemo, useState } from 'react';
import { Download, MoonStar, Pencil, Plus, Save, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { addHijriMonths, getTodayHijriParts, HIJRI_MONTHS } from '../services/hijriService.js';
import { createIslamicEvent, saveIslamicEvent, watchIslamicEvents } from '../services/islamicEventsService.js';
import {
  eventGregorianDate, eventsForHijriYear, filterIslamicEvents, formatObservanceDate,
  ISLAMIC_EVENT_CATEGORIES, observanceTone
} from '../utils/islamicEvents.js';

export default function IslamicEventsPage({ hijriOverrides = [], departments = [], venues = [] }) {
  const {user,canAccess}=useAuth();
  const isAdmin=canAccess('calendar-management');
  const [today, setToday] = useState(() => new Date());
  const currentHijri = getTodayHijriParts(hijriOverrides, today);
  const currentYear = currentHijri.year;
  const nextHijri = addHijriMonths(currentYear, currentHijri.month, 1);
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const year = selectedYear ?? currentYear;
  const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (selectedYear !== null && (selectedYear < currentYear - 5 || selectedYear > currentYear + 5)) {
      setSelectedYear(null);
    }
  }, [currentYear, selectedYear]);
  useEffect(() => {
    setLoading(true);
    setLoadError('');
    return watchIslamicEvents(items => {
      setEvents(items); setLoading(false);
    }, error => {
      setLoadError(`Could not load Key Islamic Events: ${error.message}`);
      setEvents([]); setLoading(false);
    });
  }, [retry]);
  useEffect(() => {
    if (!isAdmin) { setEditing(null); setDraft(null); setSaveError(''); }
  }, [isAdmin]);

  const result = useMemo(() => {
    try { return { rows: filterIslamicEvents(eventsForHijriYear(events, year, hijriOverrides), selectedMonth), error: '' }; }
    catch (error) { return { rows: [], error: `An event has invalid data: ${error.message}` }; }
  }, [events, year, hijriOverrides, selectedMonth]);
  let preview = '';
  let previewError = '';
  if (draft) {
    try { preview = formatObservanceDate(eventGregorianDate(draft, year, hijriOverrides)); }
    catch (error) { previewError = error.message; }
  }

  function edit(event) {
    setEditing(event);
    setDraft({ name: event.name, day: event.day, month: event.month, category: event.category });
    setSaveError(''); setNotice('');
  }
  function cancel() { setEditing(null); setDraft(null); setSaveError(''); }
  function add() {
    setEditing({});
    setDraft({ name: '', day: 1, month: selectedMonth ?? currentHijri.month, category: 'Event' });
    setSaveError(''); setNotice('');
  }
  async function save() {
    setBusy(true); setSaveError('');
    try {
      const creating = !editing.id;
      if (creating) await createIslamicEvent(draft, user.uid);
      else await saveIslamicEvent(editing, draft, user.uid);
      cancel();
      setNotice(creating
        ? 'Event added and placed in Hijri date order for all years. Month filters still apply.'
        : 'Event saved. The annual date and title are updated for all years.');
    } catch (error) { setSaveError(error.message); }
    finally { setBusy(false); }
  }
  async function downloadExcel() {
    setExportBusy(true); setExportError(''); setNotice('');
    try {
      const { downloadIslamicEventsXlsx } = await import('../services/islamicEventsExport.js');
      await downloadIslamicEventsXlsx({ events, year, hijriOverrides, departments, venues });
      setNotice(`Excel download prepared for the full ${year} AH. Complete the blank booking details before importing.`);
    } catch (error) { setExportError(`Could not export Islamic events: ${error.message}`); }
    finally { setExportBusy(false); }
  }

  return (
    <section className="islamic-events-page" aria-labelledby="islamic-events-title">
      <div className="decorative-panel islamic-events-hero">
        <div className="islamic-events-heading">
          <span className="islamic-events-icon" aria-hidden="true"><MoonStar size={28} /></span>
          <div><h1 id="islamic-events-title">Key Islamic Events</h1>
            <p>Annual observances, guided by the community Hijri calendar</p></div>
        </div>
        <label className="hijri-year-picker">Hijri year
          <select aria-label="Hijri year" value={year} disabled={!!editing} onChange={e => setSelectedYear(Number(e.target.value))}>
            {years.map(value => <option key={value} value={value}>{value} AH{value === currentYear ? ' (current)' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="glass-panel islamic-events-content">
        <div className="observance-filter-panel decorative-panel">
          <div className="observance-filter-buttons" role="group" aria-label="Islamic event date filters">
            <button type="button" disabled={!!editing} className={`lb ${year === currentYear && selectedMonth === currentHijri.month ? 'nav-active' : ''}`}
              aria-pressed={year === currentYear && selectedMonth === currentHijri.month}
              onClick={() => { setSelectedYear(currentYear); setSelectedMonth(currentHijri.month); }}>This month</button>
            <button type="button" disabled={!!editing} className={`lb ${year === nextHijri.year && selectedMonth === nextHijri.month ? 'nav-active' : ''}`}
              aria-pressed={year === nextHijri.year && selectedMonth === nextHijri.month}
              onClick={() => { setSelectedYear(nextHijri.year); setSelectedMonth(nextHijri.month); }}>Next month</button>
            <button type="button" disabled={!!editing} className={`lb ${selectedMonth === null ? 'nav-active' : ''}`}
              aria-pressed={selectedMonth === null} onClick={() => setSelectedMonth(null)}>Full year</button>
          </div>
          <label className="observance-month-picker">Custom Hijri month
            <select aria-label="Filter by Hijri month" disabled={!!editing} value={selectedMonth ?? ''} onChange={e => setSelectedMonth(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">All months</option>
              {HIJRI_MONTHS.map(month => <option key={month.value} value={month.value}>{month.name}</option>)}
            </select>
          </label>
        </div>
        <p className="muted" role="status">{selectedMonth === null ? 'Full year' : HIJRI_MONTHS[selectedMonth - 1]?.name} {year} AH{!loading && !loadError && !result.error ? ` - ${result.rows.length} event(s)` : ''}</p>
        <button type="button" className="lb lb-outline" disabled={loading || !!loadError || !!result.error || !events.some(event => event.enabled !== false) || !!editing || exportBusy}
          aria-busy={exportBusy} onClick={downloadExcel}><Download />{exportBusy ? 'Preparing Excel...' : 'Download Excel (.xlsx)'}</button>
        <p className="muted">Downloads the full selected Hijri year in the calendar Import Events template, regardless of the month filter. Complete booking type, venue and times before importing. Downloading creates no bookings.</p>
        {exportError && <p className="err" role="alert">{exportError}</p>}
        {editing && <p className="muted">Save or cancel your edit before changing the date filters.</p>}
        <div className="observance-legend" aria-label="Event colours">
          <span className="happy">Wiladat / Eid</span>
          <span className="sad">Shahadat / Wafat / Ayyam-e-Aza</span>
          <span className="occasion">Amaal / Season / Event</span>
        </div>
        <p className="muted">Gregorian dates follow the saved moon-sighting adjustments; future dates remain subject to moon sighting.</p>
        {isAdmin && <p className="muted">Edit a title, category or Hijri date below. Changes are saved to Firestore and apply every year; Gregorian dates recalculate automatically.</p>}
        {loading && <p role="status">Loading Islamic events...</p>}
        {loadError && <div className="err" role="alert">{loadError} <button className="btn" onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
        {result.error && <p className="err" role="alert">{result.error}</p>}
        {saveError && <p className="err" role="alert">{saveError}</p>}
        {notice && <p className="observance-notice" role="status">{notice}</p>}
        {isAdmin && !editing && (
          <button type="button" className="lb lb-default" onClick={add}><Plus />Add event</button>
        )}
        {isAdmin && editing && !editing.id && (
          <form className="observance-add-form" aria-label="Add Islamic event" onSubmit={e => { e.preventDefault(); save(); }}>
            <h2>Add Key Islamic Event</h2>
            <div className="observance-add-fields">
              <label>Event title<input autoFocus required aria-label="Event title" value={draft.name} maxLength={240} disabled={busy}
                onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
              <label>Hijri day<input required type="number" aria-label="Hijri day" value={draft.day} min={1} max={30} disabled={busy}
                onChange={e => setDraft({ ...draft, day: Number(e.target.value) })} /></label>
              <label>Hijri month<select aria-label="Hijri month" value={draft.month} disabled={busy}
                onChange={e => setDraft({ ...draft, month: Number(e.target.value) })}>
                {HIJRI_MONTHS.map(month => <option key={month.value} value={month.value}>{month.name}</option>)}
              </select></label>
              <label>Event category<select aria-label="Event category" value={draft.category} disabled={busy}
                onChange={e => setDraft({ ...draft, category: e.target.value })}>
                {ISLAMIC_EVENT_CATEGORIES.map(category => <option key={category}>{category}</option>)}
              </select></label>
            </div>
            <p aria-live="polite">Gregorian date ({year} AH): {previewError || preview}</p>
            <div className="observance-edit-actions">
              <button type="button" className="btn alt" disabled={busy} onClick={()=>{setDraft({...draft,name:''});setSaveError('');}}>Clear</button><button type="submit" className="lb lb-default" disabled={busy || !!previewError}><Save />{busy ? 'Adding...' : 'Add event'}</button>
              <button type="button" className="lb lb-outline" onClick={cancel} disabled={busy}><X />Cancel</button>
            </div>
          </form>
        )}
        {!loading && !loadError && !result.error && !result.rows.length && (
          <p role="status">{events.length
            ? 'No Islamic events match this month. Choose another month or Full year.'
            : `No Islamic events have been added yet.${isAdmin ? ' The Community observance list must first be imported into Firestore (see setup instructions).' : ''}`}</p>
        )}
        {!!result.rows.length && (
          <table className="observance-table">
            <thead><tr><th scope="col">Event title</th><th scope="col">Hijri date</th><th scope="col">Gregorian date ({year} AH)</th></tr></thead>
            <tbody>{result.rows.map(event => {
              const active = isAdmin && editing?.id === event.id;
              return (
                <tr key={event.id} className={`observance-row ${observanceTone(active ? draft.category : event.category)}`}>
                  <td>
                    {active ? (
                      <div className="observance-editor">
                        <label>Event title<input aria-label="Event title" value={draft.name} maxLength={240} disabled={busy}
                          onChange={e => setDraft({ ...draft, name: e.target.value })} autoFocus /></label>
                        <label>Event category<select aria-label="Event category" value={draft.category} disabled={busy}
                          onChange={e => setDraft({ ...draft, category: e.target.value })}>
                          {ISLAMIC_EVENT_CATEGORIES.map(category => <option key={category}>{category}</option>)}
                        </select></label>
                        <div className="observance-edit-actions">
                          <button type="button" className="btn alt" disabled={busy} onClick={()=>{setDraft({...draft,name:''});setSaveError('');}}>Clear</button><button className="lb lb-default" onClick={save} disabled={busy || !!previewError}><Save />{busy ? 'Saving...' : 'Save'}</button>
                          <button className="lb lb-outline" onClick={cancel} disabled={busy}><X />Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="observance-title">
                        <strong>{event.name}</strong>
                        <span className="observance-category">{event.category}</span>
                        {isAdmin && <button className="lb lb-outline" aria-label={`Edit ${event.name}`} disabled={!!editing} onClick={() => edit(event)}><Pencil />Edit</button>}
                      </div>
                    )}
                  </td>
                  <td>
                    {active ? (
                      <div className="observance-editor">
                        <label>Hijri day<input type="number" aria-label="Hijri day" value={draft.day} min={1} max={30} disabled={busy}
                          onChange={e => setDraft({ ...draft, day: Number(e.target.value) })} /></label>
                        <label>Hijri month<select aria-label="Hijri month" value={draft.month} disabled={busy}
                          onChange={e => setDraft({ ...draft, month: Number(e.target.value) })}>
                          {HIJRI_MONTHS.map(month => <option key={month.value} value={month.value}>{month.name}</option>)}
                        </select></label>
                      </div>
                    ) : <span className="observance-date">{event.day} {HIJRI_MONTHS[event.month - 1]?.name} {year} AH</span>}
                  </td>
                  <td>{active ? <span aria-live="polite">{previewError || preview}</span> : formatObservanceDate(event.gregorianDate)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
