"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { STOREFRONT_URL, formatDay, storefrontSiteUrl } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";

function Thumb({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" className="aspect-video w-20 shrink-0 rounded-lg border border-black/10 object-cover object-top" />
  ) : (
    <span className="aspect-video w-20 shrink-0 rounded-lg border border-dashed border-black/20" />
  );
}

/** "17 / 100" with a thin progress bar. Used on the Awards page and the dashboard. */
export function First100Meter({ given, limit }: { given: number; limit: number }) {
  return (
    <div className="grid gap-2">
      <p className="flex items-baseline gap-2">
        <span className="admin-mono text-4xl font-semibold tabular-nums">{given}</span>
        <span className="admin-mono text-sm text-black/55">/ {limit} given</span>
        <span className="ml-auto admin-mono text-sm">{limit - given} left</span>
      </p>
      <div
        role="progressbar"
        aria-label="First 100 badges given"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={given}
        className="h-1.5 overflow-hidden rounded-full bg-black/10"
      >
        <div className="h-full rounded-full bg-black" style={{ width: `${Math.min(100, (given / limit) * 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * The First 100 giveaway: the honorary badge for the first hundred sites.
 * Shows the count, who holds which number, and gives the next number to a
 * public site with one click. Revoking a badge frees its number.
 */
export function First100() {
  const data = useQuery(api.awards.first100, {});
  const give = useMutation(api.awards.giveFirst100);
  const revoke = useMutation(api.awards.revoke);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <p className="admin-eyebrow">Loading…</p>;

  async function run(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    try {
      showAlert(await action(), "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const q = search.trim().toLowerCase();
  const candidates = data.candidates.filter(
    (c) => !q || `${c.title} ${c.creditName} ${c.slug}`.toLowerCase().includes(q),
  );
  const full = data.left === 0;

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <div className="grid gap-8">
        <section className="admin-panel grid gap-4" aria-labelledby="f100-title">
          <h2 id="f100-title" className="text-2xl font-semibold">
            First 100
          </h2>
          <First100Meter given={data.given} limit={data.limit} />
          <p className="text-xs leading-relaxed text-black/55">
            The honorary badge for the first hundred sites. Each gets a number, 001 to 100, an award page and a badge
            its owner can embed once they claim the site. Team sites can&apos;t get one.
          </p>
        </section>

        <section className="admin-panel grid gap-4" aria-labelledby="f100-members">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="f100-members" className="text-2xl font-semibold">
              Members
            </h2>
            <p className="admin-mono text-sm">{data.given}</p>
          </div>
          {data.members.length === 0 ? (
            <p className="text-sm text-black/55">Nobody yet. Give the first badge from the list.</p>
          ) : (
            <ol className="grid gap-2">
              {data.members.map((m) => (
                <li key={m.awardId} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                  <span className="admin-mono w-10 shrink-0 text-center text-sm">{m.number}</span>
                  <Thumb src={m.listing?.coverUrl ?? null} />
                  <div className="min-w-0 flex-1">
                    {m.listing ? (
                      <a
                        href={storefrontSiteUrl(m.listing.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-sm font-semibold hover:underline"
                      >
                        {m.listing.title}
                      </a>
                    ) : (
                      <span className="text-sm text-black/55">Deleted site</span>
                    )}
                    <p className="truncate text-xs text-black/55">
                      {formatDay(m.date)} · {m.claimed ? "claimed" : "not claimed yet"}
                    </p>
                  </div>
                  <span className="flex shrink-0 gap-3 text-xs">
                    <a
                      href={`${STOREFRONT_URL}/awards/${m.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4"
                    >
                      Page
                    </a>
                    <button
                      type="button"
                      className="underline underline-offset-4"
                      disabled={busy}
                      onClick={() => {
                        const reason = prompt(`Why take First 100 No. ${m.number} back from “${m.listing?.title}”? (logged)`)?.trim();
                        if (!reason) return;
                        void run(async () => {
                          await revoke({ awardId: m.awardId, reason });
                          return `No. ${m.number} is free again.`;
                        });
                      }}
                    >
                      Revoke
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="admin-panel grid gap-5" aria-labelledby="f100-give">
        <div>
          <h2 id="f100-give" className="text-2xl font-semibold">
            Give a badge
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-black/55">
            Public sites without the badge, newest first. The site takes the next free number
            {full ? "." : ", and its owner is emailed if the site is claimed."}
          </p>
        </div>
        {full && <p className="text-sm font-medium">All {data.limit} badges are given. Revoke one to free a number.</p>}
        <input
          type="search"
          className="admin-input"
          placeholder="Search public sites"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search public sites"
        />
        {candidates.length === 0 ? (
          <p className="text-sm text-black/55">{q ? "No site matches." : "Every public site has the badge."}</p>
        ) : (
          <ul className="grid gap-2">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                <Thumb src={c.coverUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.title}</p>
                  <p className="truncate text-xs text-black/55">{c.creditName}</p>
                </div>
                <button
                  type="button"
                  className="admin-toggle shrink-0"
                  disabled={busy || full}
                  onClick={() =>
                    void run(async () => {
                      const out = await give({ listingId: c.id });
                      return `“${c.title}” is First 100 No. ${out.number}. ${out.left} left.`;
                    })
                  }
                >
                  Give
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
