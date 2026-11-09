import { useState } from 'react';
import { updateProgramExtras } from '../services/eventsService.js';

// Admin-only MWA Programs extras: shown as lists in the booking details/form, edited in a separate dialog.
export const EXTRA_SECTIONS = {
  niazSponsor: {
    title: 'Legacy Niaz sponsor (private)', single: true,
    fields: [['name', 'Sponsor name'], ['phone', 'Phone'], ['notes', 'Notes']]
  },
  reciters: {
    title: 'Reciters', addLabel: 'Add reciter',
    fields: [['name', 'Name'], ['role', 'Recites (e.g. Quran, Noha, Majlis)'], ['notes', 'Notes']]
  },
  volunteers: {
    title: 'Volunteers', addLabel: 'Add volunteer',
    fields: [['name', 'Name'], ['phone', 'Phone'], ['duty', 'Duty']]
  },
  expenses: {
    title: 'Expenses', addLabel: 'Add expense',
    fields: [['description', 'Description'], ['amount', 'Amount (AUD)'], ['paidBy', 'Paid by'], ['notes', 'Notes']]
  }
};

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const total = (list) => (list || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
const blank = (key) => Object.fromEntries(EXTRA_SECTIONS[key].fields.map(([f]) => [f, '']));
const joinParts = (...p) => p.filter(Boolean).join(' · ');

function describe(key, item) {
  if (key === 'reciters') return joinParts(item.name, item.role, item.notes);
  if (key === 'volunteers') return joinParts(item.name, item.duty, item.phone);
  if (key === 'expenses') return joinParts(item.description, money(item.amount), item.paidBy && `paid by ${item.paidBy}`, item.notes);
  return joinParts(item.name, item.phone, item.notes);
}

/** Read-only lists with a Manage button per section (admins only — callers must gate on isAdmin). */
export function ProgramExtrasSummary({ event, extras, onManage }) {
  const data = { ...event, ...(extras || {}) };
  return (
    <div className="card program-extras" style={{ marginTop: 14 }}>
      <div className="muted" style={{ marginBottom: 6 }}>Admin only — not shown to the public.</div>
      {Object.entries(EXTRA_SECTIONS).map(([key, sec]) => {
        const items = sec.single ? (data[key] ? [data[key]] : []) : (data[key] || []);
        return (
          <div key={key} className="extras-section">
            <div className="extras-head">
              <b>{sec.title}{!sec.single && items.length ? ` (${items.length})` : ''}</b>
              {onManage && <button type="button" className="btn sm" onClick={() => onManage(key)}>Manage</button>}
            </div>
            {items.length
              ? <ul className="extras-list">{items.map((it, i) => <li key={it.id || i}>{describe(key, it)}</li>)}</ul>
              : <div className="muted">None added.</div>}
            {key==='niazSponsor'&&<a href="/admin-login?module=niaz" target="_top">Open Niaz Administration for reviewed sponsorships</a>}
            {key === 'expenses' && items.length > 0 && <div><b>Total:</b> {money(total(items))}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Separate dialog to add/edit/remove the entries of one section. */
export function ProgramExtrasEditor({ eventId, section, initial, onClose, onSaved }) {
  const sec = EXTRA_SECTIONS[section];
  const [rows, setRows] = useState(() => {
    if (sec.single) return [initial ? { ...blank(section), ...initial } : blank(section)];
    return (initial || []).map(r => ({ ...blank(section), ...r, amount: r.amount ?? '' }));
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const setCell = (i, f, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [f]: v } : r)));
  const remove = (i) => setRows(rs => rs.filter((_, j) => j !== i));

  async function save() {
    setErr(''); setBusy(true);
    try {
      const value = sec.single ? (rows[0]?.name?.trim() ? rows[0] : null) : rows;
      const res = await updateProgramExtras(eventId, { [section]: value });
      onSaved && onSaved({ [section]: res[section] });
      onClose();
    } catch (e) {
      setErr(e?.message || 'Could not save.');
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay show extras-overlay" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={sec.title} onClick={e => e.stopPropagation()}>
        <button type="button" className="dlg-close" onClick={onClose} aria-label="Close dialog">✕</button>
        <h3 style={{ marginTop: 0, paddingRight: 36 }}>{sec.title}</h3>
        {rows.map((r, i) => (
          <div key={r.id || i} className="card extras-row">
            <div className="r2">
              {sec.fields.map(([f, label]) => (
                <div key={f}>
                  <label>{label}</label>
                  <input
                    value={r[f] ?? ''} inputMode={f === 'amount' ? 'decimal' : undefined}
                    onChange={e => setCell(i, f, e.target.value)}
                  />
                </div>
              ))}
            </div>
            {!sec.single && <button type="button" className="btn del sm" onClick={() => remove(i)}>Remove</button>}
            {sec.single && r.name && <button type="button" className="btn del sm" onClick={() => setRows([blank(section)])}>Clear sponsor</button>}
          </div>
        ))}
        {!sec.single && (
          <button type="button" className="btn" onClick={() => setRows(rs => [...rs, blank(section)])}>+ {sec.addLabel}</button>
        )}
        {section === 'expenses' && <div style={{ marginTop: 8 }}><b>Total:</b> {money(total(rows))}</div>}
        {err && <div className="err">{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn pri" disabled={busy} onClick={save}>Save</button>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
