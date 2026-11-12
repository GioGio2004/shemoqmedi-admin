"use client";

import { useId, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TIERS } from "@/lib/graphics/spec";
import { formatDay } from "@/lib/storefront";
import { SearchIcon } from "../icons";
import { Skel } from "../ui";

// The listing and award pickers (the same sources as the old Design page:
// admin.featuredOptions and awards.overview).

export type AwardRow = FunctionReturnType<typeof api.awards.overview>["recent"][number];

function Thumb({ url }: { url: string | null }) {
  return url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span className="st-pick-ph" aria-hidden="true" />;
}

/** A live site: the chosen one as a row with "Change", else a search over every public listing. */
export function ListingPicker({ value, onPick }: { value: Id<"listings"> | null; onPick: (id: Id<"listings">) => void }) {
  const listings = useQuery(api.admin.featuredOptions, {});
  const [search, setSearch] = useState("");
  const [browsing, setBrowsing] = useState(value === null);
  const id = useId();
  const chosen = listings?.find((l) => l.id === value);

  if (listings === undefined) {
    return (
      <div className="st-picker" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skel key={i} style={{ height: 60, borderRadius: 12 }} />
        ))}
      </div>
    );
  }
  if (chosen && !browsing) {
    return (
      <div className="st-pick" data-chosen="true" role="group" aria-label="Chosen listing">
        <Thumb url={chosen.coverUrl} />
        <span className="st-list-main">
          <span className="st-list-title">{chosen.title}</span>
          <span className="st-list-meta">{chosen.creditName}</span>
        </span>
        <button type="button" className="st-btn st-btn-quiet st-btn-sm" onClick={() => setBrowsing(true)}>
          Change
        </button>
      </div>
    );
  }
  const q = search.trim().toLowerCase();
  const matches = listings.filter((l) => !q || `${l.title} ${l.creditName} ${l.slug}`.toLowerCase().includes(q)).slice(0, 8);
  return (
    <div className="st-stack">
      <div className="st-search">
        <SearchIcon size={18} />
        <input id={id} className="st-input" type="search" inputMode="search" placeholder="Search live sites" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search live sites" />
      </div>
      <div className="st-picker">
        {matches.map((l) => (
          <button
            key={l.id}
            type="button"
            className="st-pick"
            aria-pressed={l.id === value}
            onClick={() => {
              onPick(l.id);
              setBrowsing(false);
            }}
          >
            <Thumb url={l.coverUrl} />
            <span className="st-list-main">
              <span className="st-list-title">{l.title}</span>
              <span className="st-list-meta">{l.creditName}</span>
            </span>
          </button>
        ))}
        {matches.length === 0 && <p className="st-note">No live site matches “{search}”.</p>}
      </div>
    </div>
  );
}

/** An active award (newest first); picking one also picks its site. */
export function AwardPicker({ value, onPick }: { value: string | null; onPick: (award: AwardRow) => void }) {
  const overview = useQuery(api.awards.overview, {});
  const [all, setAll] = useState(false);
  if (overview === undefined) {
    return (
      <div className="st-picker" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skel key={i} style={{ height: 60, borderRadius: 12 }} />
        ))}
      </div>
    );
  }
  const awards = overview.recent.filter((a) => a.status === "active" && a.listing);
  if (awards.length === 0) return <p className="st-note">No awards yet. Pick “Listing” or fill the text by hand.</p>;
  const chosen = awards.find((a) => a.slug === value);
  const shown = chosen && !all ? [chosen] : awards.slice(0, all ? 40 : 6);
  return (
    <div className="st-picker">
      {shown.map((a) => (
        <button
          key={a.id}
          type="button"
          className="st-pick"
          aria-pressed={a.slug === value}
          onClick={() => {
            onPick(a);
            setAll(false);
          }}
        >
          <Thumb url={a.listing?.coverUrl ?? null} />
          <span className="st-list-main">
            <span className="st-list-title">{a.listing?.title}</span>
            <span className="st-list-meta">
              {TIERS[a.tier as keyof typeof TIERS] ?? a.tier} · {formatDay(a.date)}
            </span>
          </span>
          <span className="st-badge" data-tone={a.slug === value ? "ink" : undefined}>
            {a.tier}
          </span>
        </button>
      ))}
      <button type="button" className="st-btn st-btn-quiet st-btn-sm" onClick={() => setAll(!all)}>
        {chosen && !all ? "Change award" : all ? "Fewer" : "More awards"}
      </button>
    </div>
  );
}
