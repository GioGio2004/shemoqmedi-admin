"use client";

import { showError } from "./Alerts";
import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  CATEGORIES,
  CREATOR_TIERS,
  LIMITS,
  REGIONS,
  TECHNOLOGIES,
  type CreatorTier,
  type RegionSlug,
} from "@/convex/lib/taxonomy";

type Listing = NonNullable<FunctionReturnType<typeof api.listings.reviewDetail>>;
type UpdateArgs = FunctionArgs<typeof api.admin.updateListing>;

type Fields = {
  title: string;
  slug: string;
  url: string;
  tagline: string;
  juryNote: string;
  categories: string[];
  technologies: string[];
  creditName: string;
  creditUrl: string;
  creatorTier: CreatorTier;
  region: RegionSlug;
  isClaimed: boolean;
};

type Key = keyof Fields;
const KEYS: Key[] = [
  "title",
  "slug",
  "url",
  "tagline",
  "juryNote",
  "categories",
  "technologies",
  "creditName",
  "creditUrl",
  "creatorTier",
  "region",
  "isClaimed",
];

function fromListing(l: Listing): Fields {
  return {
    title: l.title,
    slug: l.slug,
    url: l.url,
    tagline: l.tagline,
    juryNote: l.juryNote ?? "",
    categories: l.categories,
    technologies: l.technologies,
    creditName: l.creditName,
    creditUrl: l.creditUrl ?? "",
    creatorTier: l.creatorTier,
    region: l.region,
    isClaimed: l.isClaimed,
  };
}

function differs(a: Fields[Key], b: Fields[Key]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.join("\u0000") !== b.join("\u0000");
  if (typeof a === "string" && typeof b === "string") return a.trim() !== b.trim();
  return a !== b;
}

/**
 * Edit every descriptive field of one listing. Only the fields that differ
 * from the saved listing are sent; after a save the form shows the server's
 * (normalised) values again.
 */
export function ListingEditForm({ listing }: { listing: Listing }) {
  const update = useMutation(api.admin.updateListing);
  const saved = fromListing(listing);
  const [edits, setEdits] = useState<Partial<Fields>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const value: Fields = { ...saved, ...edits };
  const changed = KEYS.filter((k) => differs(value[k], saved[k]));
  const missing =
    !value.title.trim() ||
    !value.slug.trim() ||
    !value.url.trim() ||
    !value.creditName.trim() ||
    value.categories.length === 0;
  const renaming = changed.includes("creditName");

  function set<K extends Key>(key: K, next: Fields[K]) {
    setDone(false);
    setError(null);
    setEdits((e) => ({ ...e, [key]: next }));
  }

  function toggleCategory(slug: string) {
    const list = value.categories;
    set("categories", list.includes(slug) ? list.filter((c) => c !== slug) : [...list, slug]);
  }

  function toggleTech(name: string) {
    const list = value.technologies;
    set("technologies", list.includes(name) ? list.filter((t) => t !== name) : [...list, name]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || missing || changed.length === 0) return;
    const args: UpdateArgs = { id: listing.id };
    for (const k of changed) {
      const v = value[k];
      (args as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() : v;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await update(args);
      setEdits({});
      setDone(true);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="edit-heading">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <p id="edit-heading" className="admin-eyebrow">
          Listing details
        </p>
        <p className="text-xs text-black/55">
          {changed.length === 0
            ? "No unsaved changes"
            : `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}`}
        </p>
      </div>

      <form onSubmit={onSubmit} className="grid gap-6">
        <fieldset disabled={busy} className="grid gap-6">
          <div className="grid gap-6 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="admin-eyebrow">Site title</span>
              <input
                className="admin-input"
                value={value.title}
                maxLength={LIMITS.title}
                required
                onChange={(e) => set("title", e.target.value)}
              />
            </label>
            <label className="grid gap-2">
              <span className="admin-eyebrow">Page address</span>
              <span className="flex items-stretch">
                <span className="admin-mono flex items-center rounded-l-[12px] border border-r-0 border-black/10 px-3 text-black/55">
                  /sites/
                </span>
                <input
                  className="admin-input"
                  // .admin-input is unlayered CSS, so a Tailwind rounded-l-none would lose to it.
                  style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                  value={value.slug}
                  required
                  spellCheck={false}
                  autoCapitalize="none"
                  onChange={(e) => set("slug", e.target.value)}
                />
              </span>
              <span className="text-xs text-black/55">
                Letters, numbers and dashes. Old links to /sites/{listing.slug} redirect to the new address.
              </span>
            </label>
          </div>

          <label className="grid gap-2">
            <span className="admin-eyebrow">Live URL</span>
            <input
              className="admin-input"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              value={value.url}
              maxLength={LIMITS.url}
              required
              spellCheck={false}
              onChange={(e) => set("url", e.target.value)}
              placeholder="example.com or https://example.com"
            />
          </label>

          <label className="grid gap-2">
            <span className="flex items-baseline justify-between gap-3">
              <span className="admin-eyebrow">Short description</span>
              <span className="admin-mono text-black/55">
                {value.tagline.length}/{LIMITS.tagline}
              </span>
            </span>
            <textarea
              className="admin-input resize-y"
              rows={2}
              value={value.tagline}
              maxLength={LIMITS.tagline}
              onChange={(e) => set("tagline", e.target.value)}
            />
          </label>

          <label className="grid gap-2">
            <span className="flex items-baseline justify-between gap-3">
              <span className="admin-eyebrow">Jury note</span>
              <span className="admin-mono text-black/55">
                {value.juryNote.length}/{LIMITS.juryNote}
              </span>
            </span>
            <textarea
              className="admin-input resize-y"
              rows={4}
              value={value.juryNote}
              maxLength={LIMITS.juryNote}
              onChange={(e) => set("juryNote", e.target.value)}
              placeholder="A few sentences on what makes this site stand out. Shown on its page."
            />
            <span className="text-xs text-black/55">Optional. Leave empty to hide it.</span>
          </label>

          <div className="grid gap-6 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="admin-eyebrow">Made by</span>
              <input
                className="admin-input"
                value={value.creditName}
                maxLength={LIMITS.creditName}
                required
                onChange={(e) => set("creditName", e.target.value)}
              />
              {renaming && (
                <span className="text-xs text-black/55">
                  Saving relinks this listing to the creator profile named &ldquo;{value.creditName.trim()}&rdquo;
                  (created if it doesn&apos;t exist yet).
                </span>
              )}
            </label>
            <label className="grid gap-2">
              <span className="admin-eyebrow">Creator website</span>
              <input
                className="admin-input"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                value={value.creditUrl}
                maxLength={LIMITS.url}
                spellCheck={false}
                onChange={(e) => set("creditUrl", e.target.value)}
                placeholder="Leave empty to remove"
              />
            </label>
          </div>

          <fieldset>
            <legend className="admin-eyebrow mb-3">
              Categories <span className="admin-mono">{value.categories.length}/{LIMITS.categories}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = value.categories.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    className="admin-toggle"
                    aria-pressed={on}
                    disabled={!on && value.categories.length >= LIMITS.categories}
                    onClick={() => toggleCategory(c.slug)}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-black/55">
              {value.categories.length === 0
                ? "Pick at least one category."
                : "The first one you pick is the main category."}
            </p>
          </fieldset>

          <div className="grid gap-6 md:grid-cols-2">
            <fieldset className="grid content-start gap-2">
              <legend className="admin-eyebrow mb-2">Creator tier</legend>
              <div className="flex flex-wrap gap-2">
                {CREATOR_TIERS.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    className="admin-toggle"
                    aria-pressed={value.creatorTier === t.slug}
                    onClick={() => set("creatorTier", t.slug)}
                  >
                    {t.badge}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid content-start gap-2">
              <legend className="admin-eyebrow mb-2">Region</legend>
              <div className="flex flex-wrap gap-2">
                {REGIONS.map((r) => (
                  <button
                    key={r.slug}
                    type="button"
                    className="admin-toggle"
                    aria-pressed={value.region === r.slug}
                    onClick={() => set("region", r.slug)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset>
            <legend className="admin-eyebrow mb-3">
              Technologies <span className="admin-mono">{value.technologies.length}/{LIMITS.technologies}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {TECHNOLOGIES.map((t) => {
                const on = value.technologies.includes(t.name);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    className="admin-toggle admin-toggle-mono"
                    aria-pressed={on}
                    disabled={!on && value.technologies.length >= LIMITS.technologies}
                    onClick={() => toggleTech(t.name)}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="admin-check">
            <input
              type="checkbox"
              checked={value.isClaimed}
              onChange={(e) => set("isClaimed", e.target.checked)}
            />
            <span>
              Site claimed
              <small>Mark this site as claimed by the people who made it.</small>
            </span>
          </label>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm font-medium">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-black/10 pt-6">
          <button type="submit" className="admin-button" disabled={busy || missing || changed.length === 0}>
            {busy ? "Saving…" : "Save details"}
          </button>
          {changed.length > 0 && !busy && (
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={() => {
                setEdits({});
                setError(null);
              }}
            >
              Discard changes
            </button>
          )}
          {done && changed.length === 0 && (
            <span role="status" className="text-xs text-black/55">
              Saved.
            </span>
          )}
          {missing && (
            <span className="text-xs text-black/55">Title, page address, live URL and Made by are required.</span>
          )}
        </div>
      </form>
    </section>
  );
}
