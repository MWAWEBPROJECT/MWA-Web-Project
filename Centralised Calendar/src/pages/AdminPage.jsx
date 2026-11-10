import {bookingToneIndex,bookingTypeStyle} from '@mwa/appearance';
import PaletteShadePicker from '../components/PaletteShadePicker.jsx';
import { useEffect, useState } from 'react';
import { useAuth, OWNER_EMAIL } from '../contexts/AuthContext.jsx';
import {
  createVenue, updateVenue, deleteVenue,
  createDepartment, updateDepartment, deleteDepartment
} from '../services/directoryService.js';
import BookingModal from '../components/BookingModal.jsx';
import { Trash2 } from 'lucide-react';
import { useBookingDeletion } from '../components/useBookingDeletion.jsx';

export default function AdminPage({ events, venues, departments, hijriOverrides, onSaved, onReloadSettings,registerBack }) {
  const auth = useAuth();
  const {user,profile,isOwner,loading}=auth;
  const isAdmin=auth.canAccess('events-bookings');
  const [sub, setSub] = useState('pending');
  useEffect(()=>{registerBack?.(sub==='pending'?null:()=>setSub('pending'));return()=>registerBack?.(null);},[sub,registerBack]);

  if (loading) return <section><p className="muted">Loading…</p></section>;
  if (!user || !isAdmin) return <LoginCard {...auth} />;

  const pending = events.filter(e => e.status === 'pending');
  const confirmed = events.filter(e => e.status === 'confirmed').sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <section>
      <div className="bar decorative-panel admin-menu" role="group" aria-label="Admin sections">
        {['pending', 'confirmed', 'venues', 'departments'].map(s => (
          <button key={s} className={`tab ${sub === s ? 'on' : ''}`} aria-pressed={sub === s} onClick={() => setSub(s)}>
            {label(s)}{s === 'pending' && pending.length ? ` (${pending.length})` : ''}
          </button>
        ))}
      </div>
      {(sub === 'pending' || sub === 'confirmed') && (
        <BookingQueue key={sub} bookings={sub === 'pending' ? pending : confirmed} pending={sub === 'pending'}
          venues={venues} departments={departments} hijriOverrides={hijriOverrides} onSaved={onSaved} />
      )}
      {sub === 'venues' && <VenuesTab venues={venues} />}
      {sub === 'departments' && <DepartmentsTab departments={departments} />}
    </section>
  );
}

function label(s) {
  return { pending: 'Pending approvals', confirmed: 'Confirmed bookings', venues: 'Venues', departments: 'Booking Types' }[s];
}

const GOOGLE_ERRORS = {
  'auth/operation-not-allowed': 'Google sign-in is not enabled for this Firebase project.',
  'auth/unauthorized-domain': 'This website address is not in Firebase Authentication → Settings → Authorized domains.',
  'auth/popup-blocked': 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/internal-error': 'Google sign-in hit an internal error. Try again, or in a different browser.'
};

function LoginCard({ user, login, loginWithGoogle, logout, authError, passwordLoginDisabled, pendingLink, completeGoogleLink, cancelGoogleLink }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await login(email, password); }
    catch (e2) { setErr('Sign-in failed. Check the email and password.'); }
    finally { setBusy(false); }
  }

  async function google() {
    setErr(''); setBusy(true);
    try { await loginWithGoogle(); }
    catch (e2) {
      const code = e2?.code || '';
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setErr(`${GOOGLE_ERRORS[code] || 'Google sign-in failed. Please try again.'}${code ? ` (${code})` : ''}`);
      }
    }
    finally { setBusy(false); }
  }

  async function link(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await completeGoogleLink(linkPassword); setLinkPassword(''); }
    catch (e2) {
      const code = e2?.code || '';
      setErr(code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials'
        ? 'That password is not correct.'
        : `Could not link Google to this account.${code ? ` (${code})` : ''}`);
    }
    finally { setBusy(false); }
  }

  const message = err || authError;

  return (
    <section className="login-shell">
      <div className="login-panel">
        <div className="login-hero" aria-hidden="true">
          <div className="login-badge">🔐</div>
          <h3 className="login-title">Admin sign in</h3>
          <p className="login-sub">MWA Admin Console</p>
        </div>
        <div className="login-form-area">
          <p className="muted login-lede">Sign in to review booking requests, manage venues and booking types, and adjust Hijri settings.</p>
          {user && !authError && !pendingLink && (
            <div className="err login-err" role="alert">
              ⚠ {user.email || 'This account'} does not have admin access.{' '}
              <button type="button" className="link-btn" onClick={logout}>Sign out</button>
            </div>
          )}
          {message && <div className="err login-err" role="alert">⚠ {message}</div>}
          {pendingLink ? (
            <form onSubmit={link} noValidate className="login-link">
              <p className="login-link-note">
                <strong>{pendingLink.email}</strong> already has a password account here. Enter that password once to connect
                your Google sign-in to it. After this you will only need Google.
              </p>
              <div className="field">
                <label htmlFor="link-password">Current password</label>
                <input id="link-password" type="password" autoComplete="current-password" value={linkPassword}
                  onChange={e => setLinkPassword(e.target.value)} disabled={busy} required autoFocus />
              </div>
              <button className="btn pri login-submit" disabled={busy || !linkPassword} type="submit" aria-busy={busy}>
                {busy ? <><span className="spinner" aria-hidden="true" /> Connecting…</> : 'Connect Google and sign in'}
              </button>
              <button type="button" className="link-btn login-link-cancel" onClick={cancelGoogleLink} disabled={busy}>Cancel</button>
            </form>
          ) : (
            <>
              <button type="button" className="btn login-google" onClick={google} disabled={busy}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                {busy ? 'Signing in…' : 'Sign in with Google'}
              </button>
              {!passwordLoginDisabled && (
                <details className="login-alt">
                  <summary>Use email and password instead</summary>
                  <form onSubmit={submit} noValidate>
                    <div className="field">
                      <label htmlFor="admin-email">Email</label>
                      <input id="admin-email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} required />
                    </div>
                    <div className="field">
                      <label htmlFor="admin-password">Password</label>
                      <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required />
                    </div>
                    <button className="btn pri login-submit" disabled={busy} type="submit" aria-busy={busy}>
                      {busy ? <><span className="spinner" aria-hidden="true" /> Signing in…</> : 'Sign in'}
                    </button>
                  </form>
                </details>
              )}
            </>
          )}
          <p className="muted login-footnote">
            Only emails on the MWA admin team list can sign in. Ask {OWNER_EMAIL} to add you.
          </p>
        </div>
      </div>
    </section>
  );
}

function BookingQueue({ bookings, pending, venues, departments, hijriOverrides, onSaved }) {
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState([]);
  const { deleted, busy, remove, promptElement, feedback } = useBookingDeletion({
    loaded: bookings, onSaved, onRemoved: ids => setSelected(sel => sel.filter(id => !ids.includes(id)))
  });
  const visible = bookings.filter(e => !deleted.includes(e.id));
  const now = new Date().toISOString();
  const deletable = visible.filter(e => e.startAt > now);
  const chosen = deletable.filter(e => selected.includes(e.id));
  const allSelected = deletable.length > 0 && chosen.length === deletable.length;

  function toggle(id, checked) {
    setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(x => x !== id));
  }

  return (
    <div className="wrap">
      <div className="bar">
        <span>{chosen.length} selected</span>
        <button type="button" className="btn del" disabled={busy || !chosen.length} onClick={() => remove(chosen)}>
          <Trash2 size={16} aria-hidden="true" /> {busy ? 'Deleting...' : `Delete selected (${chosen.length})`}
        </button>
        <span className="muted">Past bookings are kept as records; cancel them instead.</span>
      </div>
      {feedback}
      <table>
        <thead><tr>
          <th><input type="checkbox" style={{ width: 'auto' }} aria-label="Select all deletable bookings"
            checked={allSelected} disabled={busy || !deletable.length}
            ref={el => { if (el) el.indeterminate = chosen.length > 0 && !allSelected; }}
            onChange={e => setSelected(e.target.checked ? deletable.map(item => item.id) : [])} /></th>
          <th>Date</th><th>Event</th><th>Booking type</th><th>Venue</th><th>{pending ? 'Conflict' : 'Visibility'}</th><th>Actions</th>
        </tr></thead>
        <tbody>
          {visible.map(e => (
            <tr key={e.id}>
              <td><input type="checkbox" style={{ width: 'auto' }} aria-label={`Select ${e.title}`}
                checked={selected.includes(e.id)} disabled={busy || e.startAt <= now}
                onChange={event => toggle(e.id, event.target.checked)} /></td>
              <td>{new Date(e.startAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}</td>
              <td>{e.title}</td>
              <td>{e.departmentName || e.departmentId}</td>
              <td>{e.venueName || e.venueId}</td>
              <td>{pending
                ? (e.hasConflict ? <span className="conflict-badge">overlap</span> : '—')
                : <span className={`tag vis-${e.visibility || 'private'}`}>{e.visibility || 'private'}</span>}</td>
              <td>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn" disabled={busy} onClick={() => setModal({ editing: e })}>Review</button>
                  <button type="button" className="btn del" aria-label={`Delete ${e.title}`}
                    title={e.startAt <= now ? 'Past bookings are kept as records' : 'Delete booking'}
                    disabled={busy || e.startAt <= now} onClick={() => remove([e])}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!visible.length && <tr><td colSpan={7} className="muted">{pending ? 'Nothing pending.' : 'No confirmed bookings yet.'}</td></tr>}
        </tbody>
      </table>
      {modal && (
        <BookingModal open={true} onClose={() => setModal(null)} venues={venues} departments={departments}
          editing={modal.editing} isAdmin hijriOverrides={hijriOverrides} onSaved={onSaved} />
      )}
      {promptElement}
    </div>
  );
}

function VenuesTab({ venues }) {
  const [form, setForm] = useState({ name: '', capacity: '', bufferHours: '', openingHours: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  async function add(e) {
    e.preventDefault();
    if (!form.name) return;
    await createVenue(form);
    setForm({ name: '', capacity: '', bufferHours: '', openingHours: '' });
  }
  function startEdit(v) {
    setEditingId(v.id);
    setEditForm({
      name: v.name || '', capacity: v.capacity ?? '',
      bufferHours: resolveVenueBufferHours(v), openingHours: v.openingHours || '',
      coversAllVenues: v.coversAllVenues === true
    });
  }
  function cancelEdit() { setEditingId(null); setEditForm(null); }
  async function saveEdit(id) {
    await updateVenue(id, {
      name: editForm.name, capacity: Number(editForm.capacity) || null,
      bufferHours: Number(editForm.bufferHours) || 0, openingHours: editForm.openingHours || '',
      coversAllVenues: !!editForm.coversAllVenues
    });
    cancelEdit();
  }
  return (
    <div>
      <form className="card" onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><label>Capacity</label><input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} /></div>
        <div><label>Buffer (hours, after booking)</label><input type="number" step="0.25" min="0" value={form.bufferHours} onChange={e => setForm(f => ({ ...f, bufferHours: e.target.value }))} /></div>
        <button className="btn pri" type="submit">Add venue</button>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Capacity</th><th>Buffer</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {venues.map(v => editingId === v.id ? (
            <tr key={v.id}>
              <td>
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={!!editForm.coversAllVenues} onChange={e => setEditForm(f => ({ ...f, coversAllVenues: e.target.checked }))} />
                  Whole site (conflicts with every venue)
                </label>
              </td>
              <td><input type="number" style={{ width: 80 }} value={editForm.capacity} onChange={e => setEditForm(f => ({ ...f, capacity: e.target.value }))} /></td>
              <td><input type="number" step="0.25" min="0" style={{ width: 80 }} value={editForm.bufferHours} onChange={e => setEditForm(f => ({ ...f, bufferHours: e.target.value }))} /> hr</td>
              <td>
                <input type="checkbox" checked={v.active !== false} onChange={e => updateVenue(v.id, { active: e.target.checked })} />
              </td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn pri" type="button" onClick={() => saveEdit(v.id)}>Save</button>
                <button className="btn" type="button" onClick={cancelEdit}>Cancel</button>
              </td>
            </tr>
          ) : (
            <tr key={v.id}>
              <td>{v.name}</td><td>{v.capacity ?? '—'}</td><td>{resolveVenueBufferHours(v)} hr</td>
              <td>
                <input type="checkbox" checked={v.active !== false} onChange={e => updateVenue(v.id, { active: e.target.checked })} />
              </td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn" type="button" onClick={() => startEdit(v)}>Edit</button>
                <button className="btn del" onClick={() => deleteVenue(v.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// Safe read-time fallback for venues created before the bufferMinutes -> bufferHours
// rename: prefer bufferHours, else convert legacy bufferMinutes, else 0. No destructive
// Firestore migration is required — every read resolves consistently.
function resolveVenueBufferHours(v) {
  if (v.bufferHours !== undefined && v.bufferHours !== null) return Number(v.bufferHours) || 0;
  if (v.bufferMinutes !== undefined && v.bufferMinutes !== null) return Math.round(((Number(v.bufferMinutes) || 0) / 60) * 100) / 100;
  return 0;
}

function DepartmentsTab({ departments }) {
  const [form, setForm] = useState({ name: '', paletteTone: departments.length % 6 });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  async function add(e) {
    e.preventDefault();
    if (!form.name) return;
    await createDepartment(form);
    setForm({ name: '', paletteTone: departments.length % 6 });
  }
  function startEdit(d) {
    setEditingId(d.id);
    setEditForm({ name: d.name || '', paletteTone: bookingToneIndex(d) });
  }
  function cancelEdit() { setEditingId(null); setEditForm(null); }
  async function saveEdit(id) {
    await updateDepartment(id, { name: editForm.name, paletteTone: editForm.paletteTone });
    cancelEdit();
  }
  return (
    <div>
      <p className="muted">Booking-type shades follow the selected website palette. Choose a shade for each type; its colour adapts when the palette changes.</p>
      <form className="card" onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <PaletteShadePicker value={form.paletteTone} onChange={paletteTone=>setForm(f=>({...f,paletteTone}))}/>
        <button className="btn pri" type="submit">Add booking type</button>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Palette shade</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {departments.map(d => editingId === d.id ? (
            <tr key={d.id}>
              <td><input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></td>
              <td><PaletteShadePicker compact value={editForm.paletteTone} onChange={paletteTone=>setEditForm(f=>({...f,paletteTone}))}/></td>
              <td><input type="checkbox" checked={d.active !== false} onChange={e => updateDepartment(d.id, { active: e.target.checked })} /></td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn pri" type="button" onClick={() => saveEdit(d.id)}>Save</button>
                <button className="btn" type="button" onClick={cancelEdit}>Cancel</button>
              </td>
            </tr>
          ) : (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td><span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, ...bookingTypeStyle(d) }} /></td>
              <td><input type="checkbox" checked={d.active !== false} onChange={e => updateDepartment(d.id, { active: e.target.checked })} /></td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn" type="button" onClick={() => startEdit(d)}>Edit</button>
                <button className="btn del" onClick={() => deleteDepartment(d.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
