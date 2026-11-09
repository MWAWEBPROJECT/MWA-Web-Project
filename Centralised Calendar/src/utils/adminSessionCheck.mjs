// A frame can reuse its live parent's bootstrap check; document listeners still enforce current access.
export function sessionIdentity(user) {
  return user ? JSON.stringify([user.uid,user.email,user.emailVerified,user.providerData?.map(value=>value.providerId).sort()]) : '';
}
export function createAdminSessionCheck(currentUser, check) {
  let identity = '', pending;
  const run = user => {
    const next = sessionIdentity(user);
    if (!next || sessionIdentity(currentUser()) !== next) return Promise.reject(Error('Admin session changed.'));
    if (identity !== next) {
      identity = next;
      pending = Promise.resolve().then(check).catch(error => { if(identity===next){identity = ''; pending = null;} throw error; });
    }
    return pending;
  };
  run.reset = () => {identity='';pending=null;};
  return run;
}
