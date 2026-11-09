/** The public site, for "view on site" links. */
export const STOREFRONT_URL = (
  process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://www.shemoqmedi.space"
).replace(/\/$/, "");

export function storefrontSiteUrl(slug: string) {
  return `${STOREFRONT_URL}/sites/${slug}`;
}

/** "2026-11-09" (a UTC calendar day) -> "9 Nov 2026". */
export function formatDay(day: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export function formatDate(ms: number) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}
