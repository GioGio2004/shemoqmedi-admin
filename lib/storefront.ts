/** The public site, for "view on site" links. */
export const STOREFRONT_URL = (
  process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://www.shemoqmedi.space"
).replace(/\/$/, "");

export function storefrontSiteUrl(slug: string) {
  return `${STOREFRONT_URL}/sites/${slug}`;
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
