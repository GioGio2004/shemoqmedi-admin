"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/taxonomy";
import { STOREFRONT_URL, storefrontSiteUrl } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";

type Option = FunctionReturnType<typeof api.admin.featuredOptions>[number];

const STATUS_LABEL: Record<string, string> = { in_voting: "In voting", awarded: "Awarded", archived: "Archived" };

function Thumb({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" className="aspect-video w-24 shrink-0 rounded-lg border border-black/10 object-cover object-top" />
  ) : (
    <span className="aspect-video w-24 shrink-0 rounded-lg border border-dashed border-black/20" />
  );
}

/**
 * The home page's featured header: which sites it shows and in what order.
 * Edits are a draft until "Save header". An empty list hands the header
 * back to the automatic order (award winners, top scores, newest).
 */
export function FeaturedManager() {
  const options = useQuery(api.admin.featuredOptions, {});
  const save = useMutation(api.admin.setFeatured);

  const saved = useMemo(
    () => (options ?? []).filter((o) => o.featuredRank !== null).map((o) => o.id),
    [options],
  );
  const [draft, setDraft] = useState<Id<"listings">[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const list = draft ?? saved;
  const byId = useMemo(() => new Map((options ?? []).map((o) => [o.id, o])), [options]);
  const featured = list.map((id) => byId.get(id)).filter((o): o is Option => !!o);
  const dirty = draft !== null && draft.join() !== saved.join();
  const full = list.length >= LIMITS.featured;

  const q = search.trim().toLowerCase();
  const others = (options ?? []).filter(
    (o) => !list.includes(o.id) && (!q || `${o.title} ${o.creditName} ${o.slug}`.toLowerCase().includes(q)),
  );

  const edit = (next: Id<"listings">[]) => setDraft(next);
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    edit(next);
  };

  async function onSave() {
    if (busy || !dirty || !draft) return;
    setBusy(true);
    try {
      await save({ ids: draft });
      setDraft(null);
      showAlert(
        draft.length
          ? "Header saved. The home page shows it within a minute."
          : "Header cleared: the home page is back to the automatic order within a minute.",
        "success",
      );
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Home page</p>
          <h1>Featured.</h1>
          <p>
            The sites in the home page header, in order: the first is the first slide. Up to {LIMITS.featured}. Leave it
            empty to let the header pick automatically (award winners, then top scores, then newest).
          </p>
        </div>
        <a href={STOREFRONT_URL} target="_blank" rel="noopener noreferrer" className="admin-button admin-button-secondary">
          View home page
        </a>
      </div>

      {options === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <section className="admin-panel grid gap-5" aria-labelledby="featured-title">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="featured-title" className="text-2xl font-semibold">
                In the header
              </h2>
              <p className="admin-mono text-sm">
                {featured.length} / {LIMITS.featured}
              </p>
            </div>

            {featured.length === 0 ? (
              <p className="text-sm leading-relaxed text-black/55">
                Nothing chosen: the header picks automatically. Add sites from the list to take control.
              </p>
            ) : (
              <ol className="grid gap-2">
                {featured.map((o, i) => (
                  <li key={o.id} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                    <span className="admin-mono w-6 shrink-0 text-center text-sm">{i + 1}</span>
                    <Thumb src={o.coverUrl} />
                    <div className="min-w-0 flex-1">
                      <a
                        href={storefrontSiteUrl(o.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-sm font-semibold hover:underline"
                      >
                        {o.title}
                      </a>
                      <p className="truncate text-xs text-black/55">{o.creditName}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="admin-toggle"
                        disabled={busy || i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={`Move ${o.title} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="admin-toggle"
                        disabled={busy || i === featured.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Move ${o.title} down`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="admin-toggle"
                        disabled={busy}
                        onClick={() => edit(list.filter((id) => id !== o.id))}
                        aria-label={`Remove ${o.title} from the header`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-black/10 pt-5">
              <button type="button" className="admin-button" disabled={!dirty || busy} onClick={onSave}>
                {busy ? "Saving…" : "Save header"}
              </button>
              {dirty && (
                <button type="button" className="admin-text-link" disabled={busy} onClick={() => setDraft(null)}>
                  Undo changes
                </button>
              )}
              {dirty && <span className="text-xs text-black/55">Unsaved changes</span>}
            </div>
          </section>

          <section className="admin-panel grid gap-5" aria-labelledby="add-title">
            <h2 id="add-title" className="text-2xl font-semibold">
              Add a site
            </h2>
            <input
              type="search"
              className="admin-input"
              placeholder="Search live sites"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search live sites"
            />
            {full && <p className="text-xs font-medium">The header is full. Remove a site to add another.</p>}
            {others.length === 0 ? (
              <p className="text-sm text-black/55">{q ? "No live site matches." : "Every live site is featured."}</p>
            ) : (
              <ul className="grid gap-2">
                {others.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                    <Thumb src={o.coverUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{o.title}</p>
                      <p className="truncate text-xs text-black/55">
                        {STATUS_LABEL[o.status] ?? o.status}
                        {o.awards.length > 0 && ` · ${o.awards.join(", ")}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="admin-toggle"
                      disabled={busy || full || !o.coverUrl}
                      title={o.coverUrl ? undefined : "Add a cover screenshot first"}
                      onClick={() => edit([...list, o.id])}
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
