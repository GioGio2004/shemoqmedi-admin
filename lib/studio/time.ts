// Studio times are Tbilisi times. Georgia is UTC+4 all year (no daylight
// saving), so a fixed offset is exact on any device, whatever its own zone.
// The schedule and reminder sheets edit "YYYY-MM-DDTHH:mm" strings (a
// datetime-local input) that always mean Tbilisi wall-clock time.

import { DAY_MS, TBILISI_OFFSET_MS } from "@/convex/lib/time";

export { TBILISI_OFFSET_MS };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const pad = (n: number) => String(n).padStart(2, "0");

/** The Tbilisi wall clock of a timestamp, as UTC fields of a shifted Date. */
function wall(ms: number) {
  return new Date(ms + TBILISI_OFFSET_MS);
}

/** A timestamp as a datetime-local value in Tbilisi time: "2026-11-13T09:30". */
export function toTbilisiInput(ms: number) {
  const d = wall(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "2026-11-13T09:30" (Tbilisi) → a timestamp; null for anything else. */
export function parseTbilisiInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi) - TBILISI_OFFSET_MS;
  // Date.UTC rolls 31 Feb into March: refuse days the month doesn't have.
  return toTbilisiInput(ms) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? ms : null;
}

/** The Tbilisi calendar day of a timestamp, "2026-11-13". */
function dayOf(ms: number) {
  return toTbilisiInput(ms).slice(0, 10);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today 09:30", "Tomorrow 18:00", "Yesterday 08:00", "Thu 20 Nov 09:30", or with the year when it isn't this one. */
export function formatTbilisi(ms: number, now = Date.now()) {
  const d = wall(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const day = dayOf(ms);
  if (day === dayOf(now)) return `Today ${time}`;
  if (day === dayOf(now + DAY_MS)) return `Tomorrow ${time}`;
  if (day === dayOf(now - DAY_MS)) return `Yesterday ${time}`;
  const year = d.getUTCFullYear() !== wall(now).getUTCFullYear() ? ` ${d.getUTCFullYear()}` : "";
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year} ${time}`;
}

/** "in 5 min", "in 3 h", "in 2 days", "4 min ago", "now". */
export function relativeTime(ms: number, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "now";
  const unit = abs < HOUR ? `${Math.round(abs / MINUTE)} min` : abs < DAY_MS ? `${Math.round(abs / HOUR)} h` : `${Math.round(abs / DAY_MS)} day${Math.round(abs / DAY_MS) === 1 ? "" : "s"}`;
  return diff > 0 ? `in ${unit}` : `${unit} ago`;
}

/** Tbilisi "HH:mm" on the day `daysAhead` from now's Tbilisi day. */
function atTbilisi(now: number, daysAhead: number, hour: number, minute = 0) {
  const day = dayOf(now + daysAhead * DAY_MS);
  return parseTbilisiInput(`${day}T${pad(hour)}:${pad(minute)}`)!;
}

/** A sensible first suggestion: an hour from now, rounded up to the next quarter hour. */
export function suggestedTime(now = Date.now()) {
  const q = 15 * MINUTE;
  return Math.ceil((now + HOUR) / q) * q;
}

export type QuickTime = { label: string; at: number };

/** One-tap times for the schedule and reminder sheets, all in the future. */
export function quickTimes(now = Date.now()): QuickTime[] {
  const tonight = atTbilisi(now, 0, 20);
  const tonightLeft = tonight > now + 30 * MINUTE;
  return [
    // Exactly an hour, rounded up to the minute.
    { label: "In 1 hour", at: Math.ceil((now + HOUR) / MINUTE) * MINUTE },
    tonightLeft ? { label: "Tonight 20:00", at: tonight } : { label: "Tomorrow 20:00", at: atTbilisi(now, 1, 20) },
    { label: "Tomorrow 10:00", at: atTbilisi(now, 1, 10) },
  ];
}

/** The device's offset from Tbilisi in minutes (0 when the phone is set to Tbilisi time). */
export function deviceOffsetFromTbilisi(ms = Date.now()) {
  return -new Date(ms).getTimezoneOffset() - TBILISI_OFFSET_MS / MINUTE;
}

/** "13:30 your time" when the device isn't on Tbilisi time, else null. */
export function deviceTimeNote(ms: number) {
  if (deviceOffsetFromTbilisi(ms) === 0) return null;
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} your time`;
}
