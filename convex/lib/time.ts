// Award calendar time: Asia/Tbilisi. Georgia has been UTC+4 all year since
// 2005 (no daylight saving), so a fixed offset is exact and needs no time
// zone data in the Convex runtime.

export const TBILISI_OFFSET_MS = 4 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** A calendar day in Tbilisi, "2026-11-12". */
export type Day = string;

const iso = (ms: number) => new Date(ms).toISOString();

/** The Tbilisi calendar day of a timestamp. */
export function tbilisiDay(ms: number): Day {
  return iso(ms + TBILISI_OFFSET_MS).slice(0, 10);
}

/** The Tbilisi month of a timestamp, "2026-11". */
export function tbilisiMonth(ms: number) {
  return tbilisiDay(ms).slice(0, 7);
}

/** The Tbilisi year of a timestamp, "2026". */
export function tbilisiYear(ms: number) {
  return tbilisiDay(ms).slice(0, 4);
}

/** Midnight in Tbilisi at the start of `day`, as a timestamp. */
export function dayStart(day: Day): number {
  return Date.parse(`${day}T00:00:00Z`) - TBILISI_OFFSET_MS;
}

/** `day` at "HH:MM" Tbilisi time, as a timestamp. */
export function atTime(day: Day, time: string): number {
  const [h, m] = parseTime(time);
  return dayStart(day) + h * 3_600_000 + m * 60_000;
}

/** "HH:MM" → [hours, minutes]; throws on anything else. */
export function parseTime(time: string): [number, number] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error(`"${time}" is not a time like 00:00.`);
  return [Number(match[1]), Number(match[2])];
}

export function addDays(day: Day, n: number): Day {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A real calendar day in YYYY-MM-DD form. */
export function isDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && addDays(day, 0) === day;
}

/** The Monday (Tbilisi) of the week containing `ms`: the batch it belongs to. */
export function weekOf(ms: number): Day {
  const day = tbilisiDay(ms);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * A weekly batch: sites approved Monday 00:00 – Sunday 23:59 (Tbilisi) form
 * batch `week`. It is judged the following week, so voting closes at the end
 * of the Sunday a week later.
 */
export function batchVotingEnds(week: Day): number {
  return dayStart(addDays(week, 14)) - 1;
}

/** The first day of the month after `month` ("2026-11" → "2026-12-01"). */
export function nextMonthStart(month: string): Day {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** The month before the one `day` is in ("2026-12-01" → "2026-11"). */
export function previousMonth(day: Day): string {
  const [y, m] = day.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** `day` plus `months` calendar months (the day clamps to the month's end). */
export function addMonths(day: Day, months: number): Day {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
