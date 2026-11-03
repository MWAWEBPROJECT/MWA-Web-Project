const { localToUtcIso } = require('./dateUtils');
const MODULES = ['enquiries','events-bookings','calendar-management','tools-automation','website-cms','form-builder','islamic-events','website','niaz','volunteers','members','maintenance','expenses','donations','social-media','speakers-reciters'];
function moduleFor(entry) {
  if (MODULES.includes(entry.module)) return entry.module;
  if (entry.entityType === 'admin' || String(entry.action).startsWith('admin.')) return 'tools-automation';
  if (entry.entityType === 'hijri' || entry.entityType === 'calendarSettings') return 'calendar-management';
  if (entry.entityType === 'website') return 'website-cms';
  if (entry.entityType === 'islamicEvent') return 'islamic-events';
  return 'events-bookings';
}
function auditEntry(entry, now = new Date().toISOString()) {
  return { entityType: entry.entityType, entityId: entry.entityId, action: entry.action,
    module: moduleFor(entry), userId: entry.userId || null,
    userEmail: String(entry.userEmail || '').trim().toLowerCase() || null,
    note: entry.note || '', diff: entry.diff || null, timestamp: now };
}
function changedValues(before = {}, after = {}) {
  const fields = [...new Set([...Object.keys(before),...Object.keys(after)])]
    .filter(key => !['updatedAt','updatedBy','adjustedBy'].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return Object.fromEntries(fields.map(key => [key,{before:before[key] ?? null,after:after[key] ?? null}]));
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
}
function auditFilters(input = {}) {
  const from = input.from || '', to = input.to || '', user = String(input.user || '').trim().toLowerCase();
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) throw Error('Choose a valid date range.');
  if (user.length > 254) throw Error('The user filter is too long.');
  if (input.module && !MODULES.includes(input.module)) throw Error('Choose a valid module.');
  let end = null;
  if (to) { const next = new Date(to+'T12:00:00Z'); next.setUTCDate(next.getUTCDate()+1); end = localToUtcIso(next.toISOString().slice(0,10),'00:00'); }
  return { from:from ? localToUtcIso(from,'00:00') : null, to:end, user, module:input.module || '' };
}
function matchesAudit(entry, filters) {
  return (!filters.user || String(entry.userEmail || '').toLowerCase().includes(filters.user) || String(entry.userId || '').toLowerCase() === filters.user)
    && (!filters.module || moduleFor(entry) === filters.module);
}
module.exports = { MODULES,moduleFor,auditEntry,changedValues,validDate,auditFilters,matchesAudit };
