"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showAlert, showError } from "./Alerts";
import { storefrontCreatorUrl } from "./format";

// Pick a listing's owner straight from the admin: search any signed-up account
// by name or email and make it the owner, no claim link needed
// (claimLinks.setListingOwner). People without an account still get a claim link.

export type OwnerRef = { id: Id<"users">; name: string; email: string };

/** The listing's creator profile ("Made by") and the account holding it. */
export type CreatorRef = {
  slug: string;
  name: string;
  isClaimed: boolean;
  claimedBy: { id: Id<"users">; name: string } | null;
};

/** Search box with matching accounts; `onPick` gets the chosen one. */
export function OwnerSearch({
  onPick,
  currentId,
  busy,
  pickLabel = "Make owner",
}: {
  onPick: (user: OwnerRef) => void;
  currentId?: Id<"users"> | null;
  busy?: boolean;
  pickLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const term = search.trim();
  const results = useQuery(api.claimLinks.ownerCandidates, term.length >= 2 ? { search: term } : "skip");

  return (
    <div className="grid gap-2">
      <label className="grid gap-1">
        <span className="text-xs text-black/55">Find an account by name or email</span>
        <input
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="admin-input"
          placeholder="name@studio.com"
        />
      </label>
      {term.length >= 2 && (
        <ul className="grid gap-1" aria-live="polite">
          {results === undefined ? (
            <li className="text-xs text-black/55">Searching…</li>
          ) : results.length === 0 ? (
            <li className="text-xs text-black/55">
              No account matches. They need to sign up on the site first, or send them a claim link.
            </li>
          ) : (
            results.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{u.name}</span>{" "}
                  <span className="text-black/55 [overflow-wrap:anywhere]">{u.email}</span>
                  {u.listings > 0 && (
                    <span className="admin-mono ml-2 text-black/45">
                      owns {u.listings} {u.listings === 1 ? "site" : "sites"}
                    </span>
                  )}
                </span>
                {u.id === currentId ? (
                  <span className="admin-mono text-black/55">Current owner</span>
                ) : (
                  <button
                    type="button"
                    className="admin-button admin-button-secondary"
                    disabled={busy}
                    onClick={() => {
                      onPick({ id: u.id, name: u.name, email: u.email });
                      setSearch("");
                    }}
                  >
                    {pickLabel}
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The listing page's Owner panel: who owns it, assign or change the owner,
 * remove them. The listing's creator profile goes with the owner; a profile
 * left behind (listings assigned before that) is handed over from here.
 */
export function ListingOwnerPanel({
  listingId,
  owner,
  isClaimed,
  creator,
}: {
  listingId: Id<"listings">;
  owner: OwnerRef | null;
  isClaimed: boolean;
  creator: CreatorRef | null;
}) {
  const setOwner = useMutation(api.claimLinks.setListingOwner);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  async function assign(user: OwnerRef) {
    const replacing = owner ? ` It replaces ${owner.name} (${owner.email}).` : "";
    const profile = creator ? ` The creator profile "${creator.name}" becomes theirs too.` : "";
    const reason = prompt(
      `Make ${user.name} (${user.email}) the owner of this site? It becomes claimed and its links followed.${profile}${replacing} Reason (optional, for the audit log):`,
      "",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      const out = await setOwner({ listingId, userId: user.id, reason: reason || undefined });
      showAlert(
        creator && !out.creatorProfile
          ? `${user.name} now owns this site. The creator profile "${creator.name}" stays with ${creator.claimedBy?.name ?? "its current holder"}.`
          : `${user.name} now owns this site${creator ? ` and the creator profile "${creator.name}"` : ""}.`,
        "success",
      );
      setChanging(false);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function giveProfile() {
    if (!owner || !creator) return;
    setBusy(true);
    try {
      const out = await setOwner({ listingId, userId: owner.id });
      if (out.creatorProfile) showAlert(`The creator profile "${creator.name}" now belongs to ${owner.name}.`, "success");
      else showAlert(`"${creator.name}" belongs to another account (${creator.claimedBy?.name ?? "unknown"}). Change it on that account first.`, "error");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const who = owner ? `${owner.name} (${owner.email})` : "its owner";
    const reason = prompt(
      `Take this site from ${who}? It becomes unclaimed again, ready for a new owner or claim link. Reason (optional, for the audit log):`,
      "",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      await setOwner({ listingId, userId: null, reason: reason || undefined });
      showAlert("Owner removed. The site is unclaimed again.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel grid gap-4" aria-labelledby="owner-heading">
      <p id="owner-heading" className="admin-eyebrow">
        Owner
      </p>
      {owner ? (
        <p className="text-sm">
          <span className="font-medium">{owner.name}</span>{" "}
          <span className="text-black/55 [overflow-wrap:anywhere]">{owner.email}</span>
        </p>
      ) : (
        <p className="text-sm text-black/55">
          {isClaimed ? "Marked claimed, but no account owns it." : "Nobody owns this site yet."}
        </p>
      )}
      {creator && <CreatorStatus creator={creator} owner={owner} busy={busy} onGive={giveProfile} />}
      <p className="text-xs leading-relaxed text-black/55">
        Give the site to an account directly, no claim link needed: it is claimed at once, its links are followed and
        the owner can edit it from their account. Owners never vote on or judge their own site. Every change is written
        to the audit log.
      </p>
      {owner && !changing ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={() => setChanging(true)}>
            Change owner
          </button>
          <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={remove}>
            {busy ? "Working…" : "Remove owner"}
          </button>
        </div>
      ) : (
        <>
          <OwnerSearch onPick={assign} currentId={owner?.id ?? null} busy={busy} />
          <div className="flex flex-wrap gap-3">
            {owner && (
              <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={() => setChanging(false)}>
                Cancel
              </button>
            )}
            {!owner && isClaimed && (
              <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={remove}>
                {busy ? "Working…" : "Mark unclaimed"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Whose the listing's creator profile is, and a button to hand it to the owner when it isn't theirs. */
function CreatorStatus({
  creator,
  owner,
  busy,
  onGive,
}: {
  creator: CreatorRef;
  owner: OwnerRef | null;
  busy: boolean;
  onGive: () => void;
}) {
  const theirs = owner && creator.claimedBy?.id === owner.id;
  const holder = creator.claimedBy ? creator.claimedBy.name : creator.isClaimed ? "marked claimed, no account" : "nobody yet";
  return (
    <div className="grid gap-2 rounded-xl border border-black/10 px-3 py-2">
      <p className="text-sm">
        <span className="text-black/55">Creator profile </span>
        <a href={storefrontCreatorUrl(creator.slug)} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
          {creator.name}
        </a>
        <span className="text-black/55">: {theirs ? `${owner.name}'s` : holder}</span>
      </p>
      {owner && !theirs && (
        <div>
          <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={onGive}>
            {busy ? "Working…" : `Give the profile to ${owner.name}`}
          </button>
        </div>
      )}
    </div>
  );
}
