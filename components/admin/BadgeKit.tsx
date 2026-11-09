"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { STOREFRONT_URL } from "@/lib/storefront";

type Listing = NonNullable<FunctionReturnType<typeof api.listings.reviewDetail>>;
type Award = FunctionReturnType<typeof api.awards.forListing>[number];

// Badges exist only for real awards: each award has its own badge image
// (/badge/<award slug>) and page (/awards/<award slug>). This panel gives the
// admin the code for each of a site's awards and a ready email for its
// owner (who also gets it automatically when the award is announced). The
// snippet matches the storefront (shemoqmedi/lib/badgeSvg.ts embedCode):
// keep the two identical. Link text stays the brand name only.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function badgeDate(a: Award) {
  if (a.tier === "SOTY") return a.period;
  if (a.tier === "SOTM") {
    const [y, m] = a.period.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  const [y, m, d] = a.date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const label = (a: Award) => `${a.name} · ${badgeDate(a)}`;

function snippet(a: Award, theme: "light" | "dark" = "light") {
  return (
    `<a href="${STOREFRONT_URL}/awards/${a.slug}" target="_blank" rel="noopener" title="${label(a)} on Shemoqmedi">` +
    `<img src="${STOREFRONT_URL}/badge/${a.slug}?theme=${theme}" alt="${label(a)} — Shemoqmedi" width="220" height="64"></a>`
  );
}

function email(listing: Listing, a: Award) {
  const name = listing.submitter?.name.split(" ")[0] || listing.creditName;
  return [
    `Subject: ${listing.title} won ${a.name} on Shemoqmedi`,
    "",
    `Hi ${name},`,
    "",
    `${listing.title} won ${label(a)} on Shemoqmedi, the website awards platform. Its award page is here:`,
    `${STOREFRONT_URL}/awards/${a.slug}`,
    "",
    "If you'd like to show it, here is the badge for your site. It links back to the award:",
    "",
    snippet(a),
    "",
    `A dark version, and every badge your site has won, are on your account once you claim the site: ${STOREFRONT_URL}/account/badges`,
    "",
    "If your studio keeps an awards or press page, we'd be glad to be listed there too.",
    "",
    "Congratulations,",
    "Shemoqmedi",
  ].join("\n");
}

function CopyButton({ text, label: text2 }: { text: string; label: string }) {
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
      {done ? "Copied" : text2}
    </button>
  );
}

/** Badge code and a ready-to-send email for each award a public listing won. */
export function BadgeKit({ listing }: { listing: Listing }) {
  const awards = useQuery(api.awards.forListing, { slug: listing.slug });
  const [picked, setPicked] = useState(0);
  if (!awards || awards.length === 0) return null;
  const award = awards[Math.min(picked, awards.length - 1)];
  const message = email(listing, award);

  return (
    <section className="admin-panel grid gap-4" aria-labelledby="badge-kit-heading">
      <p id="badge-kit-heading" className="admin-eyebrow">
        Badge kit
      </p>
      <div className="flex flex-wrap gap-2">
        {awards.map((a, i) => (
          <button key={a.slug} type="button" className="admin-toggle" aria-pressed={i === picked} onClick={() => setPicked(i)}>
            {label(a)}
          </button>
        ))}
      </div>
      <img src={`${STOREFRONT_URL}/badge/${award.slug}?theme=light`} alt={label(award)} width={220} height={64} />
      <p className="text-sm text-black/70">
        The owner gets this by email when the award is announced; resend it if needed.
        {listing.submitter ? (
          <>
            {" "}
            Submitter: <span className="admin-mono">{listing.submitter.email}</span>
          </>
        ) : (
          " No owner on file: find a contact on the creator's site."
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <CopyButton text={snippet(award)} label="Copy badge code" />
        <CopyButton text={message} label="Copy email" />
      </div>
      <label className="grid gap-2">
        <span className="admin-eyebrow">Email</span>
        <textarea readOnly rows={8} value={message} className="admin-input resize-y text-xs" />
      </label>
    </section>
  );
}
