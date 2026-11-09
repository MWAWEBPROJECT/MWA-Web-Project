const key = 'mwa-admin-navigation';
export function isAdminRoute(value) {
  const url = new URL(value, 'https://mwa.invalid');
  if(url.origin!=='https://mwa.invalid')return false;
  return ['/admin-login', '/cms', '/enquiries', '/calendar-management', '/tools-automation'].includes(url.pathname.replace(/\/$/, '')) ||
    (url.pathname.replace(/\/$/, '') === '/calendar' && (url.searchParams.get('view') === 'admin' || url.searchParams.has('booking')));
}
function currentPage(win){
  const path=win.location.pathname.replace(/\/$/,'');
  if(path==='/admin-login'&&!new URLSearchParams(win.location.search).has('module'))return '/admin-login';
  return win.location.pathname+win.location.search;
}
export function recordAdminPage(win = window) {
  const current = currentPage(win);
  if (!isAdminRoute(current)) return;
  try {
    const saved = JSON.parse(win.sessionStorage.getItem(key) || '[]');
    const trail = Array.isArray(saved) ? saved.filter(value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && isAdminRoute(value)).slice(-20) : [];
    if (current === '/admin-login') trail.length = 0;
    const previous = trail.lastIndexOf(current);
    if (previous >= 0) trail.splice(previous + 1);
    else trail.push(current);
    win.sessionStorage.setItem(key, JSON.stringify(trail));
  } catch (error) {
    console.warn('Admin navigation history is unavailable; using the console fallback.', error);
  }
}
export function adminBackTarget(win = window) {
  const current = currentPage(win);
  if (current === '/admin-login' || current === '/admin-login/') return '/';
  try {
    const trail = JSON.parse(win.sessionStorage.getItem(key) || '[]');
    const index = Array.isArray(trail) ? trail.lastIndexOf(current) : -1;
    const previous = index > 0 ? trail[index - 1] : null;
    if (typeof previous === 'string' && previous.startsWith('/') && !previous.startsWith('//') && isAdminRoute(previous)) return previous;
  } catch (error) {
    console.warn('Admin navigation history is unavailable; using the console fallback.', error);
  }
  return '/admin-login';
}
export function goAdminBack(win = window) {
  win.location.assign(adminBackTarget(win));
}
