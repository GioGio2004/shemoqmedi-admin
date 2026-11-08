"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { STOREFRONT_URL, storefrontSiteUrl } from "@/lib/storefront";

type Listing = NonNullable<FunctionReturnType<typeof api.listings.reviewDetail>>;

// Badges on creators' own sites are the platform's main source of followed
// backlinks. This panel gives the admin the badge code and a ready email to
// send the creator. The snippet matches the storefront's badge generator
// (shemoqmedi/components/badges/BadgeGenerator.tsx): keep the two identical.
// Link text stays the brand name only; keyword-stuffed widget links break
// Google's link spam rules.

const BADGES = {
  sotd: "Site of the Day",
  bsc: "Best Solo Creation",
  hm: "Honorable Mention",
  nominee: "Official Nominee",
} as const;
type BadgeSlug = keyof typeof BADGES;

function earnedBadge(awards: readonly string[]): BadgeSlug {
  if (awards.includes("SOTD")) return "sotd";
  if (awards.includes("BSC")) return "bsc";
  if (awards.includes("HM")) return "hm";
  return "nominee";
}

function snippet(badge: BadgeSlug, slug: string) {
  const label = BADGES[badge];
  return (
    `<a href="${STOREFRONT_URL}/sites/${slug}" target="_blank" rel="noopener" title="${label} on shemoqmedi">` +
    `<img src="${STOREFRONT_URL}/badges/${badge}-light.svg" alt="${label} — shemoqmedi" width="180" height="56"></a>`
  );
}

function email(listing: Listing, badge: BadgeSlug) {
  const name = listing.submitter?.name.split(" ")[0] || listing.creditName;
  const won = badge === "nominee" ? "is an Official Nominee" : `won ${BADGES[badge]}`;
  return [
    `Subject: ${listing.title} ${won} on Shemoqmedi`,
    "",
    `Hi ${name},`,
    "",
    `${listing.title} ${won} on Shemoqmedi, the website awards platform. Its page, with the jury and community scores, is here:`,
    storefrontSiteUrl(listing.slug),
    "",
    "If you'd like to show it, here is a badge for your site. It links back to your scores:",
    "",
    snippet(badge, listing.slug),
    "",
    `More styles (dark, floating corner) are at ${STOREFRONT_URL}/badges?site=${listing.slug}&badge=${badge}`,
    "",
    "If your studio keeps an awards or press page, we'd be glad to be listed there too.",
    "",
    "Congratulations,",
    "Shemoqmedi",
  ].join("\n");
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="admin-button admin-button-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          // Clipboard blocked: the text stays selectable in the box below.
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** Badge code and a ready-to-send email for a public listing. */
export function BadgeKit({ listing }: { listing: Listing }) {
  const isPublic = listing.status === "in_voting" || listing.status === "awarded" || listing.status === "archived";
  if (!isPublic) return null;
  const badge = earnedBadge(listing.awards);
  const code = snippet(badge, listing.slug);
  const message = email(listing, badge);

  return (
    <section className="admin-panel grid gap-4" aria-labelledby="badge-kit-heading">
      <p id="badge-kit-heading" className="admin-eyebrow">
        Badge kit
      </p>
      <p className="text-sm text-black/70">
        Earned badge: <strong>{BADGES[badge]}</strong>. Send it to the creator: each site that shows it is a followed
        link back to Shemoqmedi.
        {listing.submitter ? (
          <>
            {" "}
            Submitter: <span className="admin-mono">{listing.submitter.email}</span>
          </>
        ) : (
          " No submitter on file: find a contact on the creator's site."
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <CopyButton text={code} label="Copy badge code" />
        <CopyButton text={message} label="Copy email" />
      </div>
      <label className="grid gap-2">
        <span className="admin-eyebrow">Email</span>
        <textarea readOnly rows={8} value={message} className="admin-input resize-y text-xs" />
      </label>
    </section>
  );
}
