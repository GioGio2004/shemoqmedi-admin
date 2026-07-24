// Shared helpers for the Surprise Bags dashboard

/** tetri → "12.50 ₾" */
export function gel(tetri: number | undefined | null): string {
  if (tetri === undefined || tetri === null) return "—";
  return `${(tetri / 100).toFixed(2)} ₾`;
}

/** Pick a display string from a translated Record<string,string>. */
export function tName(
  t: Record<string, string> | undefined | null,
  locale = "en",
): string {
  if (!t) return "";
  return t[locale] ?? t.en ?? Object.values(t)[0] ?? "";
}

/** epoch ms → "18:30" local */
export function fmtTime(ms: number | undefined | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "18:30" → epoch ms today (local). Returns null when invalid. */
export function timeToEpochToday(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

/** Date → datetime-local input value "YYYY-MM-DDTHH:mm" (local time). */
export function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

/**
 * datetime-local string "YYYY-MM-DDTHH:mm" → epoch ms (parsed as LOCAL time).
 * Handles overnight pickup windows correctly because the date is explicit.
 * Returns null when invalid.
 */
export function datetimeLocalToEpoch(s: string): number | null {
  if (!s) return null;
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Discount % between original value and price (both tetri). */
export function discountPct(originalValue: number, price: number): number {
  if (!originalValue || originalValue <= 0) return 0;
  return Math.round((1 - price / originalValue) * 100);
}
