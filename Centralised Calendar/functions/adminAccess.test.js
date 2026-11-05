const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, isValidEmail, decideSignIn, checkRemoval, checkAddition, sessionAllowed, shouldDisablePasswordLogin } = require('./adminAccess');

test('normalizes and validates emails', () => {
  assert.equal(normalizeEmail('  Ali@Example.ORG '), 'ali@example.org');
  assert.equal(isValidEmail('ali@example.org'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail(''), false);
});

test('grants listed verified Google accounts', () => {
  assert.deepEqual(decideSignIn({ email: 'A@x.org', emailVerified: true, allowlisted: true }),
    { action: 'grant', email: 'a@x.org' });
});

test('denies unlisted and unverified accounts', () => {
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: true, allowlisted: false }).action, 'deny');
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: false, allowlisted: true }).reason, 'unverified-email');
  assert.equal(decideSignIn({ email: '', emailVerified: true, allowlisted: true }).reason, 'no-email');
});

test('a self-registered unverified password account cannot claim a listed email', () => {
  assert.equal(decideSignIn({ email: 'listed@x.org', emailVerified: false, allowlisted: true, userDoc: null }).action, 'deny');
});

test('same-email legacy admins keep access; unverified changed or mismatched identities are denied', () => {
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: false, allowlisted: false, userDoc: { role: 'admin', email: 'a@x.org' } }).action, 'migrate');
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: false, allowlisted: true, grantUid: 'u', uid: 'u', userDoc: { role: 'admin', email: 'a@x.org', allowlistManaged: true } }).action, 'grant');
  assert.equal(decideSignIn({ email: 'new@x.org', emailVerified: false, allowlisted: true, grantUid: 'u', uid: 'u', userDoc: { role: 'admin', email: 'a@x.org' } }).reason, 'unverified-email');
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: true, allowlisted: true, grantUid: 'other', uid: 'u', userDoc: { role: 'admin', email: 'a@x.org' } }).reason, 'grant-identity-mismatch');
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: true, allowlisted: false, userDoc: { role: 'admin', allowlistManaged: true } }).action, 'revoke');
});

test('a non-admin user doc cannot be promoted without the list', () => {
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: true, allowlisted: false, userDoc: { role: 'revoked', allowlistManaged: true } }).action, 'deny');
});

test('removal guards: owner only, owner protected', () => {
  const O = 'admin@muhammadiwelfare.org.au';
  const listed = [O, 'b@x.org'];
  assert.equal(checkRemoval({ target: 'b@x.org', requesterEmail: O, listedEmails: listed }), null);
  assert.match(checkRemoval({ target: 'b@x.org', requesterEmail: 'c@x.org', listedEmails: listed }), /Only admin@muhammadiwelfare/);
  assert.match(checkRemoval({ target: 'ADMIN@muhammadiwelfare.org.au', requesterEmail: O, listedEmails: listed }), /cannot be removed/);
  assert.match(checkRemoval({ target: 'z@x.org', requesterEmail: O, listedEmails: listed }), /not on the admin list/);
});

test('only the owner can add admins', () => {
  assert.equal(checkAddition({ target: 'n@x.org', requesterEmail: 'Admin@MuhammadiWelfare.org.au' }), null);
  assert.match(checkAddition({ target: 'n@x.org', requesterEmail: 'b@x.org' }), /Only/);
  assert.match(checkAddition({ target: 'bad', requesterEmail: 'admin@muhammadiwelfare.org.au' }), /valid email/);
});

test('owner verified sign-in is always granted', () => {
  assert.equal(decideSignIn({ email: 'admin@muhammadiwelfare.org.au', emailVerified: true, allowlisted: false, provider: 'google.com' }).action, 'grant');
});

test('password sign-in is refused once disabled', () => {
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: true, allowlisted: true, provider: 'password', passwordLoginDisabled: true }).reason, 'password-disabled');
  assert.equal(decideSignIn({ email: 'a@x.org', emailVerified: true, allowlisted: true, provider: 'google.com', passwordLoginDisabled: true }).action, 'grant');
  assert.equal(sessionAllowed({ provider: 'password', passwordLoginDisabled: true }), false);
  assert.equal(sessionAllowed({ provider: 'password', passwordLoginDisabled: false }), true);
  assert.equal(sessionAllowed({ provider: 'google.com', passwordLoginDisabled: true }), true);
});

test('only the owner signing in with Google disables password login', () => {
  assert.equal(shouldDisablePasswordLogin({ email: 'Admin@muhammadiwelfare.org.au', provider: 'google.com' }), true);
  assert.equal(shouldDisablePasswordLogin({ email: 'admin@muhammadiwelfare.org.au', provider: 'password' }), false);
  assert.equal(shouldDisablePasswordLogin({ email: 'b@x.org', provider: 'google.com' }), false);
});
