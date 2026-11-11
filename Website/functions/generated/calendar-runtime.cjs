// Generated from canonical Calendar algorithms by sync-ai-calendar.mjs.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  HIJRI_MONTHS: () => HIJRI_MONTHS,
  MWA_LOCATION: () => MWA_LOCATION,
  adjustedIslamicToGregorian: () => adjustedIslamicToGregorian,
  calculatePrayerTimes: () => calculatePrayerTimes,
  getHijriMonthLength: () => getHijriMonthLength,
  getHijriParts: () => getHijriParts
});
module.exports = __toCommonJS(stdin_exports);

// ../Centralised Calendar/src/utils/prayerTimes.js
var MWA_LOCATION = {
  fullAddress: "81-89 Clifton Avenue, Kemps Creek NSW 2178",
  latitude: -33.8738,
  longitude: 150.789,
  timeZone: "Australia/Sydney"
};
var PRAYER_OPTIONS = [
  { key: "fajr", label: "Fajr" },
  { key: "zohrain", label: "Zohrain" },
  { key: "asr", label: "Asr" },
  { key: "maghreb", label: "Maghreb" },
  { key: "isha", label: "Isha" }
];
var PRAYER_KEYS = PRAYER_OPTIONS.map((o) => o.key);
var DEG_TO_RAD = Math.PI / 180;
var RAD_TO_DEG = 180 / Math.PI;
var fixAngle = (v) => (v % 360 + 360) % 360;
var fixHour = (v) => (v % 24 + 24) % 24;
var pad2 = (n) => String(n).padStart(2, "0");
function dateToJulian(year, month, day) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}
function sunPosition(jd) {
  const d = jd - 2451545;
  const g = fixAngle(357.529 + 0.98560028 * d) * DEG_TO_RAD;
  const q = fixAngle(280.459 + 0.98564736 * d);
  const l = fixAngle(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG_TO_RAD;
  const e = (23.439 - 36e-8 * d) * DEG_TO_RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) * RAD_TO_DEG / 15;
  return { declination: Math.asin(Math.sin(e) * Math.sin(l)) * RAD_TO_DEG, equation: q / 15 - fixHour(ra) };
}
function hourAngle(angle, latitude, declination) {
  const lat = latitude * DEG_TO_RAD;
  const dec = declination * DEG_TO_RAD;
  const value = (-Math.sin(angle * DEG_TO_RAD) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  return Math.acos(Math.max(-1, Math.min(1, value))) * RAD_TO_DEG / 15;
}
function asrTime(factor, latitude, declination) {
  const angle = -Math.atan(1 / (factor + Math.tan(Math.abs(latitude - declination) * DEG_TO_RAD))) * RAD_TO_DEG;
  return hourAngle(angle, latitude, declination);
}
function timeZoneOffsetHours(dateStr, timeZone) {
  const date = /* @__PURE__ */ new Date(`${dateStr}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const v = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return (Date.UTC(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second) - date.getTime()) / 36e5;
}
function decimalToTime(value) {
  const fixed = fixHour(value + 0.5 / 60);
  const h = Math.floor(fixed);
  return `${pad2(h)}:${pad2(Math.floor((fixed - h) * 60))}`;
}
function calculatePrayerTimes(dateStr, loc = MWA_LOCATION) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  const offset = timeZoneOffsetHours(dateStr, loc.timeZone);
  if (offset === null) return null;
  const sun = sunPosition(dateToJulian(year, month, day) - loc.longitude / (15 * 24));
  const noon = fixHour(12 + offset - loc.longitude / 15 - sun.equation);
  const sunset = noon + hourAngle(0.833, loc.latitude, sun.declination);
  const maghreb = noon + hourAngle(4, loc.latitude, sun.declination);
  return {
    method: "Jafari",
    timeZone: loc.timeZone,
    fajr: decimalToTime(noon - hourAngle(16, loc.latitude, sun.declination)),
    sunrise: decimalToTime(noon - hourAngle(0.833, loc.latitude, sun.declination)),
    sunset: decimalToTime(sunset),
    zohrain: decimalToTime(noon),
    asr: decimalToTime(noon + asrTime(1, loc.latitude, sun.declination)),
    maghreb: decimalToTime(Math.max(maghreb, sunset + 7 / 60)),
    isha: decimalToTime(noon + hourAngle(14, loc.latitude, sun.declination))
  };
}

// ../Centralised Calendar/src/services/hijriService.js
var HIJRI_MONTHS = [
  { value: 1, name: "Muharram" },
  { value: 2, name: "Safar" },
  { value: 3, name: "Rabi al-Awwal" },
  { value: 4, name: "Rabi al-Thani" },
  { value: 5, name: "Jumada al-Awwal" },
  { value: 6, name: "Jumada al-Thani" },
  { value: 7, name: "Rajab" },
  { value: 8, name: "Sha'ban" },
  { value: 9, name: "Ramadan" },
  { value: 10, name: "Shawwal" },
  { value: 11, name: "Dhu al-Qi'dah" },
  { value: 12, name: "Dhu al-Hijjah" }
];
function gregorianToJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}
function jdnToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10)
  };
}
function islamicToJdnAstro(year, month, day) {
  return day + Math.ceil(29.5 * (month - 1)) + (year - 1) * 354 + Math.floor((3 + 11 * year) / 30) + 1948439;
}
function jdnToIslamicAstro(jdn) {
  const year = Math.floor((30 * (jdn - 1948439) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((jdn - 29 - islamicToJdnAstro(year, 1, 1)) / 29.5) + 1);
  const day = jdn - islamicToJdnAstro(year, month, 1) + 1;
  return { year, month, day };
}
function monthIndex(year, month) {
  return Number(year) * 12 + (Number(month) - 1);
}
function fromMonthIndex(idx) {
  return { year: Math.floor(idx / 12), month: (idx % 12 + 12) % 12 + 1 };
}
function addHijriMonths(year, month, delta) {
  return fromMonthIndex(monthIndex(year, month) + delta);
}
function compareHijri(a, b) {
  return a.year !== b.year ? a.year - b.year : a.month !== b.month ? a.month - b.month : (a.day || 1) - (b.day || 1);
}
function sortOverrides(arr) {
  const sorted = [...arr || []].map((o) => ({
    hYear: Number(o?.hYear),
    hMonth: Number(o?.hMonth),
    gDate: String(o?.gDate || "")
  })).filter((o) => o.hYear && o.hMonth && o.gDate).sort((a, b) => compareHijri(
    { year: a.hYear, month: a.hMonth },
    { year: b.hYear, month: b.hMonth }
  ));
  const cleaned = [];
  for (const override of sorted) {
    const [y, m, d] = override.gDate.split("-").map(Number);
    if (!y || !m || !d) continue;
    const jdn = gregorianToJdn(y, m, d);
    const prev = cleaned[cleaned.length - 1];
    if (prev) {
      const [py, pm, pd] = prev.gDate.split("-").map(Number);
      const monthDiff = monthIndex(override.hYear, override.hMonth) - monthIndex(prev.hYear, prev.hMonth);
      const minDays = Math.max(1, monthDiff) * 29;
      const maxDays = Math.max(1, monthDiff) * 30;
      const dayDiff = jdn - gregorianToJdn(py, pm, pd);
      if (monthDiff <= 0 || dayDiff < minDays || dayDiff > maxDays) continue;
    }
    cleaned.push(override);
  }
  return cleaned;
}
function deltaForMonth(hYear, hMonth, overrides = []) {
  let delta = 0;
  for (const ov of sortOverrides(overrides)) {
    const cmp = compareHijri(
      { year: hYear, month: hMonth },
      { year: ov.hYear, month: ov.hMonth }
    );
    if (cmp >= 0) {
      const [y, m, d] = ov.gDate.split("-").map(Number);
      delta = gregorianToJdn(y, m, d) - islamicToJdnAstro(ov.hYear, ov.hMonth, 1);
    }
  }
  return delta;
}
function adjustedIslamicToJdn(hYear, hMonth, hDay, overrides = []) {
  return islamicToJdnAstro(hYear, hMonth, hDay) + deltaForMonth(hYear, hMonth, overrides);
}
function monthStartJdn(hYear, hMonth, overrides = []) {
  return adjustedIslamicToJdn(Number(hYear), Number(hMonth), 1, overrides);
}
function getHijriMonthLength(hYear, hMonth, overrides = []) {
  const next = addHijriMonths(Number(hYear), Number(hMonth), 1);
  return monthStartJdn(next.year, next.month, overrides) - monthStartJdn(Number(hYear), Number(hMonth), overrides);
}
function adjustedIslamicToGregorian(hYear, hMonth, hDay, overrides = []) {
  const startJdn = monthStartJdn(hYear, hMonth, overrides);
  return jdnToGregorian(startJdn + (Number(hDay) - 1));
}
function adjustedGregorianToIslamic(gYear, gMonth, gDay, overrides = []) {
  try {
    if (!gYear || !gMonth || !gDay) return { year: 0, month: 0, day: 0 };
    const safeOverrides = sortOverrides(overrides);
    const target = gregorianToJdn(Number(gYear), Number(gMonth), Number(gDay));
    const approx = jdnToIslamicAstro(target);
    for (let i = -14; i <= 14; i++) {
      const cand = addHijriMonths(approx.year, approx.month, i);
      const start = monthStartJdn(cand.year, cand.month, safeOverrides);
      const next = addHijriMonths(cand.year, cand.month, 1);
      const nextStart = monthStartJdn(next.year, next.month, safeOverrides);
      if (target >= start && target < nextStart) {
        return { year: cand.year, month: cand.month, day: target - start + 1 };
      }
    }
    return approx;
  } catch {
    return { year: 0, month: 0, day: 0 };
  }
}
function getHijriParts(gregorianDate, overrides = []) {
  try {
    const [y, m, d] = (typeof gregorianDate === "string" ? gregorianDate : gregorianDate.toISOString().slice(0, 10)).split("-").map(Number);
    return adjustedGregorianToIslamic(y, m, d, overrides);
  } catch {
    return { year: 0, month: 0, day: 0 };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HIJRI_MONTHS,
  MWA_LOCATION,
  adjustedIslamicToGregorian,
  calculatePrayerTimes,
  getHijriMonthLength,
  getHijriParts
});
