import { withLiveConflicts } from '../utils/conflictUtils.js';
import { useMemo, useRef, useState } from 'react';
import { Download, Filter, Trash2, Upload, ChevronDown } from 'lucide-react';
import { hijriLabel, dateKeyInOrgTz, timeKeyInOrgTz } from '../utils/dateUtils.js';
import { downloadCsv, downloadIcs } from '../services/exportService.js';
import { importBookings, recomputeAllConflicts } from '../services/eventsService.js';
import { EXPORT_HEADERS, MAX_IMPORT_FILE_BYTES, bookingsToRows } from '../utils/excelUtils.js';
import { EMPTY_BOOKING_FILTERS, filterBookings, activeFilterCount, describeFilters } from '../utils/bookingFilters.js';
import { getHijriParts } from '../services/hijriService.js';
import { downloadTemplateXlsx } from '../services/templateService.js';
import BookingModal from '../components/BookingModal.jsx';
import { useBookingDeletion } from '../components/useBookingDeletion.jsx';

const MAX_ROWS = 500;
const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];

export default function BookingsPage({ events: rawEvents, venues, departments, isAdmin, hijriOverrides, onSaved }) {
  const events = useMemo(() => withLiveConflicts(rawEvents, venues, isAdmin), [rawEvents, venues, isAdmin]);
  const [modal, setModal] = useState(null);
  // No default date limit: bookings of any age, e.g. 2+ years back, stay browsable.
  const [filters, setFilters] = useState(EMPTY_BOOKING_FILTERS);
  const [open, setOpen] = useState({ filters: false, import: false, export: false });
  const [exportScope, setExportScope] = useState('filtered');
  const [selected, setSelected] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null); // { rows (parsed), result (dry-run) }
  const fileRef = useRef(null);
  const deletion = useBookingDeletion({
    loaded: events, onSaved, onRemoved: ids => setSelected(sel => sel.filter(id => !ids.includes(id)))
  });

  const sorted = useMemo(() => filterBookings(events, filters, dateKeyInOrgTz)
    .filter(e => !deletion.deleted.includes(e.id))
    .sort((a, b) => a.startAt.localeCompare(b.startAt)), [events, filters, deletion.deleted]);

  const now = new Date().toISOString();
  const chosen = sorted.filter(e => selected.includes(e.id));
  const chosenDeletable = chosen.filter(e => e.startAt > now);
  const allSelected = sorted.length > 0 && chosen.length === sorted.length;
  const exportList = isAdmin && exportScope === 'selected' ? chosen : sorted;
  const icsList = exportList.filter(e => e.status === 'confirmed');
  const filterCount = activeFilterCount(filters);
  const filterSummary = describeFilters(filters, { venues, departments });
  const anyBusy = busy || deletion.busy;

  const fmt = { dateKey: dateKeyInOrgTz, timeKey: timeKeyInOrgTz, hijriParts: (iso) => getHijriParts(dateKeyInOrgTz(iso), hijriOverrides) };

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
    setSelected([]);
  }
  function clearFilters() { setFilters(EMPTY_BOOKING_FILTERS); setSelected([]); }
  function setRange(years) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    setFilters(f => ({ ...f, from: dateKeyInOrgTz(d.toISOString()), to: '' }));
    setSelected([]);
  }
  function togglePanel(name) { setOpen(o => ({ ...o, [name]: !o[name] })); }
  function toggle(id, checked) {
    setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(x => x !== id));
  }

  function exportName(ext) {
    const range = `${filters.from ? `-from-${filters.from}` : ''}${filters.to ? `-to-${filters.to}` : ''}`;
    return `mwa-bookings${exportScope === 'selected' && isAdmin ? '-selected' : range}.${ext}`;
  }

  async function exportXlsx() {
    setMsg('');
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...bookingsToRows(exportList, fmt)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
    XLSX.writeFile(wb, exportName('xlsx'));
  }

  async function downloadTemplate() {
    setMsg('');
    try { await downloadTemplateXlsx({ departments, venues }); } catch (e) { setMsg('Could not build the template: ' + (e.message || e)); }
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    setMsg(''); setReport(null);
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { setMsg('Please choose an .xlsx file.'); return; }
    if (file.size > MAX_IMPORT_FILE_BYTES) { setMsg('File is too large (max 2 MB).'); return; }
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (rows.length > MAX_ROWS) { setMsg(`Too many rows (${rows.length}). The limit is ${MAX_ROWS} per import.`); return; }
      const result = await importBookings(rows, true);
      setReport({ rows, result });
    } catch (err) {
      setMsg(err?.message || 'Could not read the file.');
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    setBusy(true); setMsg('');
    try {
      const res = await importBookings(report.rows, false);
      setMsg(`Import complete: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped. Overlaps are flagged, not blocked.`);
      setReport(null);
      onSaved && onSaved();
    } catch {
      setReport(null);
      setMsg('Import could not be confirmed. Some or all bookings may already have been saved. Check Bookings before importing this file again.');
      onSaved && onSaved();
    } finally { setBusy(false); }
  }

  async function recompute() {
    setBusy(true); setMsg('');
    try {
      const res = await recomputeAllConflicts();
      setMsg(`Conflicts recalculated across ${res.venues} venue(s); ${res.changed} booking(s) updated.`);
      onSaved && onSaved();
    } catch (err) {
      setMsg(err?.message || 'Could not recalculate conflicts.');
    } finally { setBusy(false); }
  }

  const menuButton = (name, label, Icon, badge) => (
    <button type="button" className={`lb ${open[name] ? 'nav-active' : ''}`} aria-expanded={open[name]}
      aria-controls={`bookings-${name}-panel`} onClick={() => togglePanel(name)}>
      <Icon />{label}{badge ? <span className="menu-badge" aria-label={`${badge} active`}>{badge}</span> : null}
      <ChevronDown className={`menu-chevron ${open[name] ? 'up' : ''}`} />
    </button>
  );

  return (
    <section>
      <div className="decorative-panel bookings-menu" role="group" aria-label="Bookings tools">
        <div className="bookings-menu-buttons">
          {menuButton('filters', 'Filters', Filter, filterCount)}
          {isAdmin && menuButton('import', 'Import', Upload)}
          {menuButton('export', 'Export', Download)}
        </div>
        <div className="bookings-menu-summary" aria-live="polite">
          <span><b>{sorted.length}</b> of {events.length} bookings</span>
          {filterSummary && <span title="Active filters">· {filterSummary}</span>}
          {filterCount > 0 && <button type="button" className="link-btn" onClick={clearFilters}>Clear filters</button>}
        </div>
      </div>

      {open.filters && (
        <div className="card menu-subpanel" id="bookings-filters-panel" role="region" aria-label="Filters">
          <div className="filter-grid">
            <label>From<input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} /></label>
            <label>To<input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} /></label>
            <label>Booking type
              <select value={filters.departmentId} onChange={e => setFilter('departmentId', e.target.value)}>
                <option value="">All booking types</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label>Venue
              <select value={filters.venueId} onChange={e => setFilter('venueId', e.target.value)}>
                <option value="">All venues</option>
                {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label>Status
              <select value={filters.status} onChange={e => setFilter('status', e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
            </label>
            <label>Search<input type="search" placeholder="Title or contact" value={filters.search} onChange={e => setFilter('search', e.target.value)} /></label>
          </div>
          <div className="subpanel-actions">
            <button type="button" className="btn" onClick={() => setRange(2)}>Last 2 years +</button>
            <button type="button" className="btn" onClick={() => { setFilters(f => ({ ...f, from: '', to: '' })); setSelected([]); }}>All time</button>
            <button type="button" className="btn" disabled={!filterCount} onClick={clearFilters}>Clear all filters</button>
          </div>
        </div>
      )}

      {isAdmin && open.import && (
        <div className="card menu-subpanel" id="bookings-import-panel" role="region" aria-label="Import">
          <div className="subpanel-actions">
            <button type="button" className="btn" disabled={anyBusy} onClick={downloadTemplate}>Download template (.xlsx)</button>
            <button type="button" className="btn pri" disabled={anyBusy} onClick={() => fileRef.current && fileRef.current.click()}>Choose Excel file…</button>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onFile} />
            <button type="button" className="btn" disabled={anyBusy} onClick={recompute} title="Re-checks every booking against its venue's buffer">Recalculate conflicts</button>
          </div>
          <div className="muted">Upload shows a preview first; nothing is saved until you confirm. Max {MAX_ROWS} rows, 2 MB.</div>
          {report && (
            <div className="import-panel">
              <b>Import preview</b>
              <div>
                {report.result.counts.create} to create, {report.result.counts.update} to update, {report.result.counts.skip} duplicates skipped, {report.result.errors.length} error(s).
              </div>
              {report.result.errors.length > 0 && (
                <table>
                  <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                  <tbody>{report.result.errors.map((er, i) => <tr key={i}><td>{er.row}</td><td>{er.message}</td></tr>)}</tbody>
                </table>
              )}
              {report.result.rows.some(r => r.warnings.length) && (
                <table>
                  <thead><tr><th>Row</th><th>Action</th><th>Title</th><th>Warnings</th></tr></thead>
                  <tbody>
                    {report.result.rows.filter(r => r.warnings.length).map(r => (
                      <tr key={r.row}><td>{r.row}</td><td>{r.action}</td><td>{r.title}</td><td>{r.warnings.join(' ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn pri" disabled={anyBusy || report.result.errors.length > 0 || (report.result.counts.create + report.result.counts.update) === 0} onClick={confirmImport}>
                  Confirm import ({report.result.counts.create + report.result.counts.update})
                </button>
                <button type="button" className="btn" disabled={anyBusy} onClick={() => setReport(null)}>Cancel</button>
              </div>
              <div className="muted">Imported bookings default to Confirmed + Public unless the sheet says otherwise. Times are Australia/Sydney.</div>
            </div>
          )}
        </div>
      )}

      {open.export && (
        <div className="card menu-subpanel" id="bookings-export-panel" role="region" aria-label="Export">
          {isAdmin && (
            <div className="export-scope" role="radiogroup" aria-label="Bookings to export">
              <label><input type="radio" name="export-scope" checked={exportScope === 'filtered'} onChange={() => setExportScope('filtered')} />
                All filtered bookings ({sorted.length})</label>
              <label><input type="radio" name="export-scope" checked={exportScope === 'selected'} disabled={!chosen.length} onChange={() => setExportScope('selected')} />
                Selected bookings only ({chosen.length})</label>
            </div>
          )}
          {!isAdmin && <div className="muted">Exports the {sorted.length} booking(s) matching the current filters.</div>}
          <div className="subpanel-actions">
            <button type="button" className="btn" disabled={!exportList.length} onClick={() => downloadCsv(exportList, exportName('csv'))}>CSV ({exportList.length})</button>
            <button type="button" className="btn" disabled={!icsList.length} onClick={() => downloadIcs(icsList, exportName('ics'))}>iCal .ics ({icsList.length})</button>
            {isAdmin && <button type="button" className="btn" disabled={!exportList.length} onClick={exportXlsx}>Excel ({exportList.length})</button>}
          </div>
          <div className="muted">
            iCal includes confirmed bookings only{exportList.length > icsList.length ? `; ${exportList.length - icsList.length} pending, rejected or cancelled booking(s) are left out` : ''}.
          </div>
        </div>
      )}

      {msg && <div className="card" role="status">{msg}</div>}

      {isAdmin && (
        <div className="bar">
          <span>{chosen.length} selected</span>
          <button type="button" className="btn del" disabled={anyBusy || !chosenDeletable.length} onClick={() => deletion.remove(chosenDeletable)}>
            <Trash2 size={16} aria-hidden="true" /> {deletion.busy ? 'Deleting...' : `Delete selected (${chosenDeletable.length})`}
          </button>
          {chosen.length > chosenDeletable.length
            ? <span className="muted">{chosen.length - chosenDeletable.length} past booking(s) in the selection are kept as records.</span>
            : <span className="muted">Past bookings are kept as records; cancel them instead.</span>}
        </div>
      )}
      {deletion.feedback}

      <div className="wrap">
        <table>
          <thead>
            <tr>
              {isAdmin && <th><input type="checkbox" style={{ width: 'auto' }} aria-label="Select all filtered bookings"
                checked={allSelected} disabled={anyBusy || !sorted.length}
                ref={el => { if (el) el.indeterminate = chosen.length > 0 && !allSelected; }}
                onChange={e => setSelected(e.target.checked ? sorted.map(item => item.id) : [])} /></th>}
              <th>Date</th><th>Time</th><th>Event</th><th>Booking type</th><th>Venue</th><th>Status</th><th>Visibility</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(e => (
              <tr key={e.id}>
                {isAdmin && <td><input type="checkbox" style={{ width: 'auto' }} aria-label={`Select ${e.title}`}
                  checked={selected.includes(e.id)} disabled={anyBusy} onChange={event => toggle(e.id, event.target.checked)} /></td>}
                <td className="dt-cell">{new Date(e.startAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}
                  <div className="h-sub">{hijriLabel(e.startAt, hijriOverrides)}</div>
                </td>
                <td>{fmtTime(e.startAt)}–{fmtTime(e.endAt)}</td>
                <td>{e.title}{e.seriesId && !e.masked && <span className="tag series-tag" title="Part of a recurring series">series</span>}{e.hasConflict && <span className="conflict-badge">overlap</span>}</td>
                <td>{e.masked ? '—' : e.departmentName || departments.find(d => d.id === e.departmentId)?.name || e.departmentId}</td>
                <td>{e.venueName || venues.find(v => v.id === e.venueId)?.name || e.venueId}</td>
                <td><span className={`tag st-${e.status}`}>{e.status}</span></td>
                <td>{e.masked ? '—' : (e.visibility || 'private')}</td>
                <td>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn" onClick={() => setModal({ editing: e })}>{isAdmin ? 'Review' : 'View'}</button>
                    {isAdmin && (
                      <button type="button" className="btn del" aria-label={`Delete ${e.title}`}
                        title={e.startAt <= now ? 'Past bookings are kept as records' : 'Delete booking'}
                        disabled={anyBusy || e.startAt <= now} onClick={() => deletion.remove([e])}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={isAdmin ? 9 : 8} className="muted">{filterCount ? 'No bookings match these filters.' : 'No bookings to show.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {modal && (
        <BookingModal
          open={true} onClose={() => setModal(null)}
          venues={venues} departments={departments}
          editing={modal.editing} isAdmin={isAdmin} hijriOverrides={hijriOverrides}
          onSaved={onSaved}
        />
      )}
      {deletion.promptElement}
    </section>
  );
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false });
}
