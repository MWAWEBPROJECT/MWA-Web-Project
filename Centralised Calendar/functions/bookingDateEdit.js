const { adjustedIslamicToGregorian, getHijriMonthLength } = require('./hijriService');
const { resolveBookingDates } = require('./hijriRecompute');

function sameHijri(a, b) {
  return Number(a?.day) === Number(b?.day) && Number(a?.month) === Number(b?.month) && Number(a?.year) === Number(b?.year);
}

// Return only source-date fields. Existing callers without an explicit basis retain the old detach-on-move rule.
function sourceDateUpdate(before, patch, startAt, overrides, scope, dateKeyOf) {
  const requested = patch.dateBasis;
  const priorHijri = before.dateBasis === 'h' || before.dateBasis === 'hijri';
  if (requested === undefined) {
    if (!priorHijri || !before.hijriDate) return {};
    const resolved = resolveBookingDates(before, overrides);
    const endAt = patch.endAt ?? before.endAt;
    return dateKeyOf(startAt) !== dateKeyOf(resolved.startAt) || dateKeyOf(endAt) !== dateKeyOf(resolved.endAt)
      ? { dateBasis: 'gregorian', hijriDate: null } : {};
  }
  if (requested !== 'gregorian' && requested !== 'hijri') throw new Error('Choose Gregorian or Hijri as the date basis.');
  if (scope !== 'single' && before.seriesId && (requested !== (priorHijri ? 'hijri' : 'gregorian') || (requested === 'hijri' && !sameHijri(patch.hijriDate, before.hijriDate)))) {
    throw new Error('Change a recurring event’s date basis or Hijri day for this occurrence only.');
  }
  if (requested === 'gregorian') return { dateBasis: 'gregorian', hijriDate: null };
  const h = patch.hijriDate;
  const day = Number(h?.day), month = Number(h?.month), year = Number(h?.year);
  if (!Number.isInteger(year) || year < 1 || year > 2000 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > getHijriMonthLength(year, month, overrides)) {
    throw new Error('Choose a valid Hijri date under the saved moon-sighting settings.');
  }
  const g = adjustedIslamicToGregorian(year, month, day, overrides);
  const expected = `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
  if (dateKeyOf(startAt) !== expected) throw new Error('The selected Hijri date and event start date do not match. Refresh the calendar and try again.');
  return { dateBasis: 'hijri', hijriDate: { day, month, year } };
}

module.exports = { sourceDateUpdate };
