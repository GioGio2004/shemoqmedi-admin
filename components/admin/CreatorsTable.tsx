"use client";

import { showError } from "./Alerts";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  CREATOR_TIERS,
  LIMITS,
  REGIONS,
  type CreatorTier,
  type RegionSlug,
} from "@/convex/lib/taxonomy";
import { formatDate } from "@/lib/storefront";
import {
  regionLabel,
  safeHref,
  shortUrl,
  storefrontCreatorUrl,
  tierLabel,
} from "./format";

type Creator = FunctionReturnType<typeof api.admin.listCreators>[number];
type CreatorPatch = Omit<FunctionArgs<typeof api.admin.updateCreator>, "id">;

const BIO_MAX = 600;
const LOCATION_MAX = 80;

/** Same rule as the backend (convex/lib/listingHelpers.ts slugify), so the form shows the address that will be saved. */
function toSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function CreatorForm({ creator, onDone }: { creator: Creator; onDone: () => void }) {
  const update = useMutation(api.admin.updateCreator);

  const [name, setName] = useState(creator.name);
  const [slug, setSlug] = useState(creator.slug);
  const [tier, setTier] = useState<CreatorTier>(creator.tier);
  const [region, setRegion] = useState<RegionSlug>(creator.region);
  const [location, setLocation] = useState(creator.location ?? "");
  const [website, setWebsite] = useState(creator.website ?? "");
  const [bio, setBio] = useState(creator.bio ?? "");
  const [isClaimed, setIsClaimed] = useState(creator.isClaimed);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const websiteInvalid = website.trim() !== "" && safeHref(website.trim()) === null;
  const slugValue = toSlug(slug);
  const slugInvalid = slugValue === "";

  /** Only the fields that differ from what is stored. */
  function changes(): CreatorPatch {
    const patch: CreatorPatch = {};
    if (name.trim() !== creator.name) patch.name = name.trim();
    if (slugValue && slugValue !== creator.slug) patch.slug = slugValue;
    if (tier !== creator.tier) patch.tier = tier;
    if (region !== creator.region) patch.region = region;
    if (location.trim() !== (creator.location ?? "")) patch.location = location.trim();
    if (website.trim() !== (creator.website ?? "")) patch.website = website.trim();
    if (bio.trim() !== (creator.bio ?? "")) patch.bio = bio.trim();
    if (isClaimed !== creator.isClaimed) patch.isClaimed = isClaimed;
    return patch;
  }

  const patch = changes();
  const changed = Object.keys(patch).length > 0;
  const canSave = changed && name.trim() !== "" && !slugInvalid && !websiteInvalid && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    if (patch.isClaimed === false && creator.claimedBy) {
      if (!confirm(`Mark ${creator.name} as unclaimed? ${creator.claimedBy.name} will no longer own this profile.`)) {
        return;
      }
    }
    if (patch.slug !== undefined) {
      if (!confirm(`Change the profile address to /creators/${patch.slug}? Old links to /creators/${creator.slug} will stop working.`)) {
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await update({ id: creator.id, ...patch });
      onDone();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const prefix = `creator-${creator.id}`;

  return (
    <form onSubmit={onSubmit} className="admin-panel grid gap-6" aria-label={`Edit ${creator.name}`}>
      <fieldset disabled={busy} className="grid gap-6">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="admin-eyebrow">Name</span>
            <input
              required
              maxLength={LIMITS.creditName}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="admin-input"
            />
            <span className="text-xs text-black/55">Renaming also updates “Made by” on this creator’s listings.</span>
          </label>
          <label className="grid gap-2">
            <span className="admin-eyebrow">Profile address</span>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="admin-input admin-mono"
              aria-invalid={slugInvalid || undefined}
              aria-describedby={`${prefix}-slug-hint`}
            />
            <span id={`${prefix}-slug-hint`} className={slugInvalid ? "text-xs font-medium" : "text-xs text-black/55"}>
              {slugInvalid
                ? "Use at least one letter or number."
                : `/creators/${slugValue} · letters, numbers and dashes.`}
            </span>
          </label>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <fieldset className="grid gap-2">
            <legend className="admin-eyebrow mb-2">Creator tier</legend>
            <div className="flex flex-wrap gap-2">
              {CREATOR_TIERS.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  className="admin-toggle"
                  aria-pressed={tier === t.slug}
                  onClick={() => setTier(t.slug)}
                >
                  {t.badge}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="admin-eyebrow mb-2">Region</legend>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((r) => (
                <button
                  key={r.slug}
                  type="button"
                  className="admin-toggle"
                  aria-pressed={region === r.slug}
                  onClick={() => setRegion(r.slug)}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="admin-eyebrow">Location (optional)</span>
            <input
              maxLength={LOCATION_MAX}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="admin-input"
              placeholder="e.g. Tbilisi, Georgia"
            />
          </label>
          <label className="grid gap-2">
            <span className="admin-eyebrow">Website (optional)</span>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="admin-input"
              placeholder="https://studio.example"
              aria-invalid={websiteInvalid || undefined}
              aria-describedby={websiteInvalid ? `${prefix}-website-error` : undefined}
            />
            {websiteInvalid && (
              <span id={`${prefix}-website-error`} className="text-xs font-medium">
                Use a full http:// or https:// address.
              </span>
            )}
          </label>
        </div>

        <label className="grid gap-2">
          <span className="admin-eyebrow">
            Bio (optional) {bio.length}/{BIO_MAX}
          </span>
          <textarea
            rows={4}
            maxLength={BIO_MAX}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="admin-input resize-y"
          />
        </label>

        <label className="admin-check">
          <input type="checkbox" checked={isClaimed} onChange={(e) => setIsClaimed(e.target.checked)} />
          <span>
            Claimed
            <small>
              {creator.claimedBy
                ? `Owned by ${creator.claimedBy.name} (${creator.claimedBy.email}). Unticking removes the owner.`
                : "Shows the profile as claimed on the site. Ownership is handed over through Claims."}
            </small>
          </span>
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm font-medium">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="admin-button" disabled={!canSave}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={onDone}>
          Cancel
        </button>
        {!changed && <span className="text-xs text-black/55">No changes yet.</span>}
      </div>
    </form>
  );
}

function CreatorRow({ creator }: { creator: Creator }) {
  const remove = useMutation(api.admin.deleteCreator);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const websiteHref = safeHref(creator.website);
  const inUse = creator.listings > 0;

  async function onDelete() {
    if (busy || inUse) return;
    if (!confirm(`Delete the creator profile “${creator.name}”? Its claims are deleted too. This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await remove({ id: creator.id });
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <li className="claim-card">
      <div className="claim-card-main">
        <div className="min-w-0">
          <p className="admin-eyebrow">
            {tierLabel(creator.tier)} · {regionLabel(creator.region)} · added {formatDate(creator.createdAt)}
          </p>
          <h2>
            <a
              href={storefrontCreatorUrl(creator.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline underline-offset-4"
            >
              {creator.name} <span aria-hidden="true">↗</span>
            </a>
          </h2>
          <p className="claim-meta admin-mono">/creators/{creator.slug}</p>
        </div>
        <span className="admin-status" data-status={creator.isClaimed ? "awarded" : "rejected"}>
          <span className="admin-status-dot" aria-hidden="true" />
          {creator.isClaimed ? "Claimed" : "Unclaimed"}
        </span>
      </div>

      <dl className="request-fields">
        <div>
          <dt>Listings</dt>
          <dd className="admin-mono admin-score">{creator.listings}</dd>
        </div>
        <div>
          <dt>Claimed by</dt>
          <dd>
            {creator.claimedBy ? (
              <>
                {creator.claimedBy.name}
                <br />
                <a href={`mailto:${creator.claimedBy.email}`} className="underline underline-offset-4">
                  {creator.claimedBy.email}
                </a>
              </>
            ) : (
              "Nobody"
            )}
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{creator.location ?? "—"}</dd>
        </div>
        <div>
          <dt>Website</dt>
          <dd>
            {websiteHref ? (
              <a href={websiteHref} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">
                {shortUrl(websiteHref)}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {creator.bio && (
          <div className="wide">
            <dt>Bio</dt>
            <dd className="whitespace-pre-line">{creator.bio}</dd>
          </div>
        )}
      </dl>

      <div className="claim-actions">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={editing ? "admin-button" : "admin-button admin-button-secondary"}
            aria-expanded={editing}
            disabled={busy}
            onClick={() => setEditing((on) => !on)}
          >
            {editing ? "Close editor" : "Edit"}
          </button>
          <button
            type="button"
            className="admin-button admin-button-secondary"
            disabled={busy || inUse}
            onClick={onDelete}
            aria-describedby={inUse ? `creator-${creator.id}-delete-why` : undefined}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          {inUse && (
            <span id={`creator-${creator.id}-delete-why`} className="text-xs text-black/55">
              Can’t delete: {creator.listings} {creator.listings === 1 ? "listing uses" : "listings use"} this
              profile. Move or delete {creator.listings === 1 ? "it" : "them"} first.
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium">
            {error}
          </p>
        )}
        {editing && <CreatorForm creator={creator} onDone={() => setEditing(false)} />}
      </div>
    </li>
  );
}

export function CreatorsTable() {
  const creators = useQuery(api.admin.listCreators, {});
  const [search, setSearch] = useState("");

  const needle = search.trim().toLowerCase();
  const rows = creators?.filter((c) => !needle || c.name.toLowerCase().includes(needle));

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Creators</p>
          <h1>Creators.</h1>
          <p>
            Every “Made by” profile. Profiles are created when you add a site with a new credit name.
            Edit details here; a profile can be deleted once no listing uses it.
          </p>
        </div>
        <label className="grid w-full max-w-[320px] gap-2">
          <span className="admin-eyebrow">Search by name</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-input"
            placeholder="e.g. Bürocratik"
          />
        </label>
      </div>

      {rows === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          <h2>{needle ? "No match." : "No creators yet."}</h2>
          {needle
            ? `No creator name contains “${search.trim()}”.`
            : "Creator profiles appear when you add a site and credit who made it."}
        </div>
      ) : (
        <>
          <p className="admin-eyebrow mb-4" role="status">
            {rows.length} {rows.length === 1 ? "creator" : "creators"}
            {needle && creators ? ` of ${creators.length}` : ""}
          </p>
          <ul className="request-list">
            {rows.map((creator) => (
              <CreatorRow key={creator.id} creator={creator} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
