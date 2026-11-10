import { useState } from 'react';
import { OWNER_EMAIL } from '@calendar/contexts/AuthContext.jsx';
const GOOGLE_ERRORS = {
  'auth/operation-not-allowed': 'Google sign-in is not enabled for this Firebase project.',
  'auth/unauthorized-domain': 'This website address is not in Firebase Authentication → Settings → Authorized domains.',
  'auth/popup-blocked': 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/internal-error': 'Google sign-in hit an internal error. Try again, or in a different browser.'
};

export default function LoginCard({ user, login, loginWithGoogle, logout, authError, passwordLoginDisabled, pendingLink, completeGoogleLink, cancelGoogleLink }) {
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
