import NiazPublicSponsors from '../components/NiazPublicSponsors.jsx';
import {bookingTypeStyle,bookingTypeEdge} from '@mwa/appearance';
import { withLiveConflicts } from '../utils/conflictUtils.js';
import { useEffect, useMemo, useState } from 'react';
import { HIJRI_MONTHS } from '../services/hijriService.js';
import { dateKeyInOrgTz, timeKeyInOrgTz, localToUtcIso } from '../utils/dateUtils.js';
import {
  DOW,
  buildGregorianMonthGrid,
  buildHijriMonthGrid,
  dateKeyFromParts,
  gregorianCursorToHijri,
  hijriCursorToGregorian,
  shiftGregorianCursor,
  shiftHijriCursor
} from '../utils/hijriCalendarGrid.js';
import { ChevronLeft, ChevronRight, CalendarDays, MapPin, Plus, FileDown } from 'lucide-react';
import PdfExportModal from '../components/PdfExportModal.jsx';
import { getHijriParts } from '../services/hijriService.js';
import BookingModal from '../components/BookingModal.jsx';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const keyToDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const dateToKey = d => dateKeyFromParts(d.getFullYear(), d.getMonth(), d.getDate());
const addDaysKey = (key, n) => { const d = keyToDate(key); return dateToKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
const mondayOf = key => { const d = keyToDate(key); return addDaysKey(key, -((d.getDay() + 6) % 7)); };
const fmtShort = d => `${d.getDate()} ${G_ABBR_FULL[d.getMonth()]}`;
const G_ABBR_FULL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const H_ABBR = { 1: 'Muh', 2: 'Saf', 3: 'Rab I', 4: 'Rab II', 5: 'Jum I', 6: 'Jum II', 7: 'Raj', 8: 'Sha', 9: 'Ram', 10: 'Shaw', 11: 'DhQ', 12: 'DhH' };
const G_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CalendarPage({ events: rawEvents, venues, departments, isAdmin, hijriOverrides, onSaved, onPublicRangeChange }) {
  const events = useMemo(() => withLiveConflicts(rawEvents, venues, isAdmin), [rawEvents, venues, isAdmin]);
  // Which calendar drives month navigation / in-cell day numbering. Weekday
  // columns/labels are identical regardless of this choice.
  const [primary, setPrimary] = useState('gregorian'); // 'gregorian' | 'hijri'
  const [gCursor, setGCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [hCursor, setHCursor] = useState(() => gregorianCursorToHijri(gCursor.year, gCursor.month, hijriOverrides));
  const [deptFilter, setDeptFilter] = useState(() => new Set(departments.map(d => d.id)));
  const [venueFilter, setVenueFilter] = useState('');
  const [modal, setModal] = useState(() => typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('action')==='new-booking'?{editing:null,newOnDate:null}:null); // { editing } | { newOnDate }
  const [pdfOpen, setPdfOpen] = useState(false);

  const [view, setView] = useState('month'); // 'month' | 'week' | 'day'
  const todayInit = dateKeyInOrgTz(new Date().toISOString());
  const [selectedKey, setSelectedKey] = useState(todayInit);

  useEffect(() => {
    setDeptFilter(prev => {
      const next = new Set(prev);
      departments.forEach(d => { if (!next.has(d.id) && !prev.size) next.add(d.id); });
      return prev.size ? prev : new Set(departments.map(d => d.id));
    });
  }, [departments]);

  const shown = useMemo(() => events.filter(e =>
    e.status !== 'cancelled' &&
    (e.masked || !deptFilter.size || deptFilter.has(e.departmentId)) &&
    (!venueFilter || e.venueId === venueFilter)
  ), [events, deptFilter, venueFilter]);

  const todayKey = dateKeyInOrgTz(new Date().toISOString());

  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of shown) {
      const key = dateKeyInOrgTz(e.startAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [shown]);

  // Build the primary grid from its own calendar outward (not by relabeling
  // the other calendar's fixed month), so Hijri-primary navigation correctly
  // follows variable 29/30-day months and moon-sighting overrides.
  const grid = useMemo(() => (
    primary === 'hijri'
      ? buildHijriMonthGrid(hCursor.hYear, hCursor.hMonth, hijriOverrides)
      : buildGregorianMonthGrid(gCursor.year, gCursor.month, hijriOverrides)
  ), [primary, gCursor, hCursor, hijriOverrides]);

  const secondaryLabel = useMemo(() => {
    const inMonth = grid.cells.filter(c => c.inMonth);
    if (!inMonth.length) return '';
    if (primary === 'hijri') {
      const a = inMonth[0].date, b = inMonth[inMonth.length - 1].date;
      const af = a.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      const bf = b.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return af === bf ? af : `${af} – ${bf}`;
    }
    const a = inMonth[0].hijri, b = inMonth[inMonth.length - 1].hijri;
    if (!a.year || !b.year) return '';
    const an = HIJRI_MONTHS.find(m => m.value === a.month)?.name || '';
    const bn = HIJRI_MONTHS.find(m => m.value === b.month)?.name || '';
    return a.month === b.month && a.year === b.year ? `${an} ${a.year} AH` : `${an} ${a.year} – ${bn} ${b.year} AH`;
  }, [grid, primary]);

  const monthKeys = useMemo(() => new Set(grid.cells.filter(c => c.inMonth).map(c => c.key)), [grid]);
  const monthEvents = useMemo(() => shown.filter(e => monthKeys.has(dateKeyInOrgTz(e.startAt))), [shown, monthKeys]);
  const publicRange = useMemo(() => {
    const startKey = view === 'day' ? selectedKey : view === 'week' ? mondayOf(selectedKey) : grid.cells[0]?.key;
    if (!startKey) return null;
    const from = localToUtcIso(startKey, '00:00');
    const to = localToUtcIso(addDaysKey(startKey, 365), '00:00');
    return from && to ? { from, to } : null;
  }, [view, selectedKey, grid]);

  useEffect(() => {
    if (publicRange) onPublicRangeChange?.(publicRange);
  }, [onPublicRangeChange, publicRange]);

  function toggleDept(id) {
    setDeptFilter(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function goToday() {
    const d = new Date();
    const g = { year: d.getFullYear(), month: d.getMonth() };
    setGCursor(g);
    setHCursor(gregorianCursorToHijri(g.year, g.month, hijriOverrides));
    setSelectedKey(todayKey);
  }

  function shift(delta) {
    if (view === 'week' || view === 'day') {
      const next = addDaysKey(selectedKey, delta * (view === 'week' ? 7 : 1));
      setSelectedKey(next);
      const d = keyToDate(next);
      const g = { year: d.getFullYear(), month: d.getMonth() };
      setGCursor(g);
      setHCursor(gregorianCursorToHijri(g.year, g.month, hijriOverrides));
      return;
    }
    if (primary === 'hijri') setHCursor(c => shiftHijriCursor(c, delta));
    else setGCursor(c => shiftGregorianCursor(c, delta));
  }

  function setPrimaryCalendar(next) {
    if (next === primary) return;
    if (next === 'hijri') setHCursor(gregorianCursorToHijri(gCursor.year, gCursor.month, hijriOverrides));
    else setGCursor(hijriCursorToGregorian(hCursor.hYear, hCursor.hMonth, hijriOverrides));
    setPrimary(next);
  }

  const deptColor = (deptId) => bookingTypeEdge(departments.find(d => d.id === deptId));
  const makeCell = (key) => ({ key, date: keyToDate(key), hijri: getHijriParts(key, hijriOverrides), inMonth: true });
  const weekStart = mondayOf(selectedKey);
  const cells = view === 'week' ? Array.from({ length: 7 }, (_, i) => makeCell(addDaysKey(weekStart, i))) : grid.cells;
  const selDate = keyToDate(selectedKey);
  const selHijri = getHijriParts(selectedKey, hijriOverrides);
  const hijriText = (h) => (h.year ? `${h.day} ${HIJRI_MONTHS.find(m => m.value === h.month)?.name || ''} ${h.year} AH` : '');

  let title = grid.label;
  let subtitle = secondaryLabel;
  if (view === 'week') {
    const a = keyToDate(weekStart), b = keyToDate(addDaysKey(weekStart, 6));
    title = `${fmtShort(a)} – ${fmtShort(b)} ${b.getFullYear()}`;
    subtitle = `${hijriText(getHijriParts(weekStart, hijriOverrides))} – ${hijriText(getHijriParts(addDaysKey(weekStart, 6), hijriOverrides))}`;
  } else if (view === 'day') {
    title = `${DOW_LONG[selDate.getDay()]} ${selDate.getDate()} ${selDate.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}`;
    subtitle = hijriText(selHijri);
  }

  const selectedEvents = byDay.get(selectedKey) || [];
  const upcoming = useMemo(() => shown.filter(e => dateKeyInOrgTz(e.startAt) >= todayKey && e.status !== 'rejected')
    .sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 5), [shown, todayKey]);
  const pendingAll = events.filter(e => e.status === 'pending');
  const pendingConflicts = isAdmin ? pendingAll.filter(e => e.hasConflict).length : 0;
  const venueOpen = (v) => `${v.name}`;

  const eventStyle = e => {if(e.masked)return undefined;const style=bookingTypeStyle(departments.find(d=>d.id===e.departmentId));if(e.status==='pending'){delete style.background;delete style.color}return style};
  const eventPill = (e) => (
    <button key={e.id} type="button" className={`ev ${e.status === 'pending' ? 'pend' : ''} ${e.masked && e.status !== 'pending' ? 'priv' : ''} ${e.hasConflict ? 'conflict' : ''}`}
      style={eventStyle(e)}
      title={`${e.title} · ${e.venueName || e.venueId}${e.hasConflict ? ' · overlaps another booking' : ''}`}
      onClick={(ev) => { ev.stopPropagation(); setSelectedKey(dateKeyInOrgTz(e.startAt)); setModal({ editing: e }); }}>
      {e.dateBasis === 'hijri' ? '☾ ' : ''}{timeKeyInOrgTz(e.startAt)} {e.title}
    </button>
  );

  const renderCell = (cell) => {
    const list = byDay.get(cell.key) || [];
    const mainNumber = primary === 'hijri' ? cell.hijri.day : cell.date.getDate();
    const subNum = primary === 'hijri' ? cell.date.getDate() : (cell.hijri.year ? cell.hijri.day : '');
    const subMonth = primary === 'hijri' ? G_ABBR[cell.date.getMonth()] : (cell.hijri.year ? (H_ABBR[cell.hijri.month] || '') : '');
    const subLabel = subNum !== '' ? `${subNum} ${subMonth}`.trim() : null;
    const isToday = cell.key === todayKey;
    const max = view === 'week' ? 8 : 3;
    return (
      <div key={cell.key} role="button" tabIndex={0}
        aria-label={`${DOW_LONG[cell.date.getDay()]} ${cell.date.getDate()} ${G_ABBR_FULL[cell.date.getMonth()]} ${cell.date.getFullYear()}`}
        aria-pressed={cell.key === selectedKey}
        className={`calendar-date ${!cell.inMonth ? 'outside' : ''} ${isToday ? 'today' : ''} ${cell.key === selectedKey ? 'selected' : ''}`}
        onClick={() => setSelectedKey(cell.key)}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelectedKey(cell.key); } }}>
        <span className={`date-number ${primary === 'hijri' ? 'dt-h' : 'dt-g'}`}>{mainNumber}</span>
        {subLabel ? <span className={`hijri-date ${primary === 'hijri' ? 'dt-g' : 'dt-h'}`} title={subLabel}>{subLabel}</span> : null}
        {isToday && <span className="today-label">Today</span>}
        <div className="cell-events">
          {list.slice(0, max).map(eventPill)}
          {list.length > max && <div className="more">+{list.length - max} more</div>}
        </div>
      </div>
    );
  };

  const openNew = (key) => setModal({ editing: null, newOnDate: key || selectedKey });
  const monthTotal = monthEvents.length;

  return (
    <section>
      <main className="calendar-layout" style={{ marginTop: 24 }}>
        <section className="calendar-main glass-panel" aria-label="Calendar">
          <div className="calendar-toolbar">
            <div>
              <div className="month-controls">
                <button type="button" className="lb lb-outline lb-icon" aria-label="Previous period" title="Previous period" onClick={() => shift(-1)}><ChevronLeft /></button>
                <h1 className="month-title">{title}</h1>
                <button type="button" className="lb lb-outline lb-icon" aria-label="Next period" title="Next period" onClick={() => shift(1)}><ChevronRight /></button>
                <button type="button" className="lb lb-ghost lb-sm" onClick={goToday}>Today</button>
              </div>
              {subtitle && <p className="month-subtitle">{subtitle}</p>}
            </div>
            <div className="toolbar-filters">
              <div className="segmented" role="group" aria-label="Calendar system">
                {['gregorian', 'hijri'].map(b => (
                  <button key={b} type="button" aria-pressed={primary === b} onClick={() => setPrimaryCalendar(b)}>{b === 'hijri' ? 'Hijri' : 'Gregorian'}</button>
                ))}
              </div>
              <select className="venue-select" aria-label="Filter venues" value={venueFilter} onChange={e => setVenueFilter(e.target.value)}>
                <option value="">All venues</option>
                {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button type="button" className="lb lb-outline lb-sm" onClick={() => setPdfOpen(true)} title="Download monthly calendar as PDF"><FileDown size={16} /> PDF</button>
              <div className="segmented" role="group" aria-label="Calendar view">
                {['month', 'week', 'day'].map(m => (
                  <button key={m} type="button" aria-pressed={view === m} onClick={() => setView(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
                ))}
              </div>
            </div>
          </div>

          {departments.length > 0 && (
            <div className="dept-chips">
              {departments.map(d => (
                <button key={d.id} type="button" className="chip" onClick={() => toggleDept(d.id)}
                  style={bookingTypeStyle(d,deptFilter.has(d.id))} aria-pressed={deptFilter.has(d.id)}>{d.name}</button>
              ))}
            </div>
          )}

          {view === 'day' ? (
            <div className="day-view">
              <h2>{DOW_LONG[selDate.getDay()]}, {selDate.getDate()} {selDate.toLocaleDateString('en-AU', { month: 'long' })}</h2>
              <p className="dt-h">{hijriText(selHijri)}</p>
              {selectedEvents.length === 0 ? (
                <div className="day-empty">
                  <div className="empty-icon"><CalendarDays /></div>
                  <h2>No events scheduled</h2>
                  <p>No bookings for this day.</p>
                </div>
              ) : (
                <div className="day-list">
                  {selectedEvents.map(e => (
                    <button key={e.id} type="button" className="day-item" style={{ borderLeftColor: e.masked ? '#475467' : deptColor(e.departmentId) }} onClick={() => setModal({ editing: e })}>
                      <span className="t">{timeKeyInOrgTz(e.startAt)} – {timeKeyInOrgTz(e.endAt)}</span>
                      <span>
                        <strong>{e.title}</strong>{e.status==='confirmed'&&String(e.departmentName||'').toLowerCase()==='mwa programs'&&<NiazPublicSponsors compact eventId={e.id} startAt={e.startAt}/>}
                        <small>{e.venueName || venues.find(v => v.id === e.venueId)?.name || ''} · {e.status}{e.hasConflict ? ' · overlaps another booking' : ''}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="calendar-weekdays">{DOW.map(d => <span key={d}>{d}</span>)}</div>
              <div className={`calendar-grid ${view === 'week' ? 'week-grid' : ''}`}>{cells.map(renderCell)}</div>
            </>
          )}

          <div className="calendar-bottom">
            <span className="status-dot" />
            <span>{monthTotal ? `${monthTotal} event${monthTotal === 1 ? '' : 's'} this month` : 'No events scheduled'}</span>
            <span>·</span>
            <span>{shown.length} booking{shown.length === 1 ? '' : 's'} {venueFilter ? 'at this venue' : 'across all venues'}</span>
            <button type="button" className="lb lb-soft lb-sm" onClick={() => openNew()}><Plus />{monthTotal ? 'New booking' : 'Add first booking'}</button>
          </div>
        </section>

        <aside className="agenda glass-panel" aria-label="Agenda">
          <div className="agenda-heading">
            <h2>Agenda</h2>
            <span className="today-badge">{selectedKey === todayKey ? 'Today · ' : ''}{DOW_LONG[selDate.getDay()].slice(0, 3)} {selDate.getDate()}</span>
          </div>
          <section className="agenda-section">
            <div className="section-eyebrow"><span className="status-dot" />{selectedKey === todayKey ? 'Upcoming today' : 'Upcoming'}</div>
            {selectedEvents.length === 0 ? (
              <div className="empty-agenda">
                <div className="empty-icon"><CalendarDays /></div>
                <h3>Nothing scheduled</h3>
                <p>{upcoming.length ? `Next: ${upcoming[0].title} on ${fmtShort(keyToDate(dateKeyInOrgTz(upcoming[0].startAt)))}.` : 'No bookings for this day. Pick another date or add a booking.'}</p>
                <button type="button" className="lb lb-soft" onClick={() => openNew()}><Plus />Add booking</button>
              </div>
            ) : (
              selectedEvents.map(e => (
                <button key={e.id} type="button" className="agenda-item" onClick={() => setModal({ editing: e })}>
                  <span className="bar" style={{ background: e.masked ? '#475467' : deptColor(e.departmentId) }} />
                  <span>
                    <strong>{e.title}</strong>{e.status==='confirmed'&&String(e.departmentName||'').toLowerCase()==='mwa programs'&&<NiazPublicSponsors compact eventId={e.id} startAt={e.startAt}/>}
                    <small>{timeKeyInOrgTz(e.startAt)} – {timeKeyInOrgTz(e.endAt)} · {e.venueName || venues.find(v => v.id === e.venueId)?.name || ''}{e.status === 'pending' ? ' · pending' : ''}</small>
                  </span>
                </button>
              ))
            )}
          </section>
          <section className="agenda-section">
            <div className="section-eyebrow"><span className="status-dot" />Pending requests</div>
            <div className="pending-row">
              <span className="pending-count">{pendingAll.length}</span>
              <div>
                <strong>{pendingAll.length ? `${pendingAll.length} awaiting approval` : 'No pending requests'}</strong>
                <p>{isAdmin ? (pendingConflicts ? `${pendingConflicts} with conflicts` : 'Review them in Admin') : 'Unconfirmed bookings'}</p>
              </div>
            </div>
            {isAdmin && pendingAll.slice(0, 3).map(e => (
              <button key={e.id} type="button" className="agenda-item" onClick={() => setModal({ editing: e })}>
                <span className="bar" style={{ background: 'var(--amber)' }} />
                <span><strong>{e.title}</strong>{e.status==='confirmed'&&String(e.departmentName||'').toLowerCase()==='mwa programs'&&<NiazPublicSponsors compact eventId={e.id} startAt={e.startAt}/>}<small>{dateKeyInOrgTz(e.startAt)} {timeKeyInOrgTz(e.startAt)}{e.hasConflict ? ' · conflict' : ''}</small></span>
              </button>
            ))}
          </section>
          <section className="agenda-section">
            <div className="section-eyebrow"><MapPin size={12} />Venue availability</div>
            <div className="venue-info">
              {venues.length === 0 ? <p>No venues have been set up yet.</p> : (
                <ul>
                  {venues.map(v => {
                    const n = (byDay.get(selectedKey) || []).filter(e => e.venueId === v.id).length;
                    return <li key={v.id}><strong>{venueOpen(v)}</strong><small>{n ? `${n} booking${n === 1 ? '' : 's'} on this day` : 'Available on this day'}{v.bufferHours ? ` · ${v.bufferHours}h buffer` : ''}</small></li>;
                  })}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </main>

      {modal && (
        <BookingModal
          open={true}
          onClose={() => setModal(null)}
          venues={venues}
          departments={departments}
          editing={modal.editing}
          initialDate={modal.newOnDate}
          isAdmin={isAdmin}
          hijriOverrides={hijriOverrides}
          onSaved={() => { onSaved(); }}
        />
      )}
      {pdfOpen && (
        <PdfExportModal
          events={events}
          venues={venues}
          departments={departments}
          isAdmin={isAdmin}
          overrides={hijriOverrides}
          initial={{ basis: primary, gCursor, hCursor, deptFilter: [...deptFilter], venueFilter }}
          onClose={() => setPdfOpen(false)}
        />
      )}
    </section>
  );
}