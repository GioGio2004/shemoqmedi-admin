// Studio contact details for the social desk: the private contact email and
// the social handles used to tag a studio. Shared by the admin creator form
// (admin.updateCreator) and the MCP connector (mcp.updateCreator).

import { ConvexError } from "convex/values";

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

/** "  Hello@Studio.com " → "hello@studio.com". Throws on anything that isn't one address. */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    throw new ConvexError(`"${input.trim().slice(0, 80)}" is not an email address.`);
  }
  return email;
}

export function isEmail(input: string): boolean {
  const email = input.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email);
}

export type Socials = { instagram?: string; facebook?: string; linkedin?: string };
export const SOCIAL_NETWORKS = ["instagram", "facebook", "linkedin"] as const;

/**
 * A handle as typed or pasted ("@studio", "studio", a profile URL) → "studio",
 * or "" to clear it. LinkedIn keeps the "company/x" or "in/x" path, since
 * those are two different kinds of page.
 */
export function cleanHandle(network: (typeof SOCIAL_NETWORKS)[number], input: string): string {
  let value = input.trim();
  if (!value) return "";
  const url = /^(?:https?:\/\/)?(?:[a-z]+\.)?(instagram\.com|facebook\.com|fb\.com|linkedin\.com)\/(.+)$/i.exec(value);
  if (url) value = url[2];
  value = value.replace(/^@/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const ok =
    network === "linkedin"
      ? /^(?:(?:company|in|school|showcase)\/)?[A-Za-z0-9_.%-]{1,100}$/.test(value)
      : /^[A-Za-z0-9_.-]{1,60}$/.test(value);
  if (!ok) throw new ConvexError(`"${input.trim().slice(0, 80)}" doesn't look like a ${network} handle.`);
  return value;
}

/** Merges handle edits into the current ones; "" clears a network. Undefined when nothing is left. */
export function mergeSocials(current: Socials | undefined, edits: Partial<Record<keyof Socials, string>>): Socials | undefined {
  const next: Socials = { ...(current ?? {}) };
  for (const network of SOCIAL_NETWORKS) {
    const edit = edits[network];
    if (edit === undefined) continue;
    const handle = cleanHandle(network, edit);
    if (handle) next[network] = handle;
    else delete next[network];
  }
  return Object.keys(next).length ? next : undefined;
}

/** "@handle" for tagging in a caption, or null. */
export function tagOf(socials: Socials | undefined, network: keyof Socials): string | null {
  const handle = socials?.[network];
  if (!handle) return null;
  return network === "linkedin" ? `linkedin.com/${handle}` : `@${handle}`;
}
