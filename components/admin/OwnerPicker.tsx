"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showAlert, showError } from "./Alerts";

// Pick a listing's owner straight from the admin: search any signed-up account
// by name or email and make it the owner, no claim link needed
// (claimLinks.setListingOwner). People without an account still get a claim link.

export type OwnerRef = { id: Id<"users">; name: string; email: string };

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

/** The listing page's Owner panel: who owns it, assign or change the owner, remove them. */
export function ListingOwnerPanel({
  listingId,
  owner,
  isClaimed,
}: {
  listingId: Id<"listings">;
  owner: OwnerRef | null;
  isClaimed: boolean;
}) {
  const setOwner = useMutation(api.claimLinks.setListingOwner);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  async function assign(user: OwnerRef) {
    const replacing = owner ? ` It replaces ${owner.name} (${owner.email}).` : "";
    const reason = prompt(
      `Make ${user.name} (${user.email}) the owner of this site? It becomes claimed and its links followed.${replacing} Reason (optional, for the audit log):`,
      "",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      await setOwner({ listingId, userId: user.id, reason: reason || undefined });
      showAlert(`${user.name} now owns this site.`, "success");
      setChanging(false);
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
