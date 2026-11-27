import { useEffect, useMemo, useState } from 'react';
import { HIJRI_MONTHS, getHijriParts } from '../services/hijriService.js';
import { buildGregorianMonthGrid, buildHijriMonthGrid, shiftGregorianCursor, shiftHijriCursor, DOW } from '../utils/hijriCalendarGrid.js';
import './booking-date-picker.css';

function cursorFor(date, basis, overrides) {
  const [year, month] = String(date || '').split('-').map(Number);
  if (!year || !month) return basis === 'h' ? { year: 1448, month: 1 } : { year: 2026, month: 0 };
  const h = getHijriParts(date, overrides);
  return basis === 'h' ? { year: h.year, month: h.month } : { year, month: month - 1 };
}

export default function BookingDatePicker({ basis, selectedDate, overrides = [], onSelect }) {
  const [cursor, setCursor] = useState(() => cursorFor(selectedDate, basis, overrides));
  useEffect(() => { setCursor(cursorFor(selectedDate, basis, overrides)); }, [selectedDate, basis, overrides]);
  const grid = useMemo(() => basis === 'h'
    ? buildHijriMonthGrid(cursor.year, cursor.month, overrides)
    : buildGregorianMonthGrid(cursor.year, cursor.month, overrides), [basis, cursor, overrides]);
  const shift = amount => setCursor(current => basis === 'h'
    ? (() => { const next = shiftHijriCursor({ hYear: current.year, hMonth: current.month }, amount); return { year: next.hYear, month: next.hMonth }; })()
    : shiftGregorianCursor(current, amount));
  return <div className="booking-date-picker" role="group" aria-label={basis === 'h' ? 'Choose a Hijri date' : 'Choose a Gregorian date'}>
    <div className="booking-date-picker-toolbar">
      <button type="button" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
      <strong>{grid.label}</strong>
      <button type="button" onClick={() => shift(1)} aria-label="Next month">›</button>
    </div>
    <div className="booking-date-picker-grid booking-date-picker-days">{DOW.map(day => <span key={day}>{day}</span>)}</div>
    <div className="booking-date-picker-grid">{grid.cells.map(cell => {
      const h = cell.hijri;
      const primary = basis === 'h' ? h.day : cell.date.getDate();
      const secondary = basis === 'h' ? cell.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : `${h.day} ${HIJRI_MONTHS.find(m => m.value === h.month)?.name.slice(0, 3) || ''}`;
      return <button key={cell.key} type="button" className={`${cell.inMonth ? '' : 'outside '}${selectedDate === cell.key ? 'selected' : ''}`} aria-pressed={selectedDate === cell.key} aria-label={`${cell.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}, ${h.day} ${HIJRI_MONTHS.find(m => m.value === h.month)?.name || ''} ${h.year} AH`} onClick={() => onSelect(cell.key)}>
        <strong>{primary}</strong><small>{secondary}</small>
      </button>;
    })}</div>
    <p>Dates follow MWA Calendar Management’s moon-sighting settings.</p>
  </div>;
}
