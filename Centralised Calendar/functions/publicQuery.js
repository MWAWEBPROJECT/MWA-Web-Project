const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const MAX_RESULTS = 1000;
const PAGE_SIZE = 200;
const { localToUtcIso } = require('./dateUtils');

function parseInstant(value, label) {
  if (typeof value !== 'string' || value.length > 40) throw new Error(`A valid ${label} date is required.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`A valid ${label} date is required.`);
  return parsed;
}

function validateRange(from, to) {
  const start = parseInstant(from, 'start');
  const end = parseInstant(to, 'end');
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > MAX_RANGE_DAYS * DAY_MS) {
    throw new Error(`Choose a date range of up to ${MAX_RANGE_DAYS} days.`);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

function defaultFeedRange(now = Date.now()) {
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  return {
    from: from.toISOString(),
    to: new Date(from.getTime() + MAX_RANGE_DAYS * DAY_MS).toISOString()
  };
}

function civilDayRange(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('A valid date in YYYY-MM-DD format is required.');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('A valid date in YYYY-MM-DD format is required.');
  }
  const next = new Date(parsed.getTime() + DAY_MS).toISOString().slice(0, 10);
  return {
    from: localToUtcIso(date, '00:00'),
    to: localToUtcIso(next, '00:00')
  };
}

function overlapsRange(event, from, to) {
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) &&
    start < new Date(to).getTime() && end > new Date(from).getTime();
}

function encodeCursor(startAt, endAt, id) {
  return Buffer.from(JSON.stringify([startAt, endAt, id])).toString('base64url');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length > 512) throw new Error('The event page cursor is invalid.');
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 3 ||
        typeof value[0] !== 'string' || !Number.isFinite(new Date(value[0]).getTime()) ||
        typeof value[1] !== 'string' || !Number.isFinite(new Date(value[1]).getTime()) ||
        typeof value[2] !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(value[2])) {
      throw new Error();
    }
    return { startAt: new Date(value[0]).toISOString(), endAt: new Date(value[1]).toISOString(), id: value[2] };
  } catch {
    throw new Error('The event page cursor is invalid.');
  }
}

module.exports = {
  DAY_MS, MAX_RANGE_DAYS, MAX_RESULTS, PAGE_SIZE,
  validateRange, defaultFeedRange, civilDayRange, overlapsRange, encodeCursor, decodeCursor
};
