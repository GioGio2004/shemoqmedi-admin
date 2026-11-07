"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AWARDS, DAY_MS, LIMITS, VOTING_DAYS } from "@/convex/lib/taxonomy";
import { formatDate, storefrontSiteUrl } from "@/lib/storefront";
import { AwardBadges, STATUS_LABEL, StatusBadge } from "./ReviewQueue";
import { errorMessage, type AwardSlug, type ListingStatus } from "./format";

type Listing = NonNullable<FunctionReturnType<typeof api.listings.reviewDetail>>;
type LifecycleArgs = FunctionArgs<typeof api.admin.setLifecycle>;

const TARGETS: { status: ListingStatus; label: string; hint: string }[] = [
  { status: "pending", label: "Pending", hint: "Hidden from the site and back in the review queue." },
  { status: "in_voting", label: "Live voting", hint: "Public, with a voting window that closes at the time below." },
  { status: "awarded", label: "Awarded", hint: "Voting closed with the awards you pick below." },
  { status: "archived", label: "Closed", hint: "Voting closed without an award. The page stays public." },
  { status: "rejected", label: "Rejected", hint: "Hidden from the site. The owner sees the reason." },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** ms timestamp -> value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time, no offset) -> ms timestamp, or null. */
function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function defaultVotingEnd(current: number | null): string {
  const now = Date.now();
  return toLocalInput(current && current > now ? current : now + VOTING_DAYS * DAY_MS);
}

/**
 * Status control for one listing: quick actions (approve, close voting) plus
 * a manual override to any status with its voting window, awards or reason.
 * The parent remounts it (via key) whenever the lifecycle changes, so the
 * defaults always come from the saved listing.
 */
export function LifecyclePanel({ listing }: { listing: Listing }) {
  const setLifecycle = useMutation(api.admin.setLifecycle);
  const approve = useMutation(api.listings.approve);
  const closeVoting = useMutation(api.listings.closeVotingNow);

  const status = listing.status;
  const [target, setTarget] = useState<ListingStatus>(status);
  const [endsAt, setEndsAt] = useState(() => defaultVotingEnd(listing.votingEndsAt));
  const [awards, setAwards] = useState<AwardSlug[]>(listing.awards);
  const [note, setNote] = useState(listing.reviewNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown when a save leaves the key unchanged (e.g. same reason or same awards);
  // otherwise the panel remounts and the new badge/timestamps are the confirmation.
  const [message, setMessage] = useState<string | null>(null);

  const isPublic = status === "in_voting" || status === "awarded" || status === "archived";
  const targetInfo = TARGETS.find((t) => t.status === target)!;
  const same = target === status;
  const nothingToSave = same && (target === "pending" || target === "archived");
  const invalid =
    (target === "in_voting" && fromLocalInput(endsAt) === null) ||
    (target === "awarded" && awards.length === 0) ||
    (target === "rejected" && !note.trim());

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function shiftEnd(days: number) {
    // Calendar days in local time, so the clock time survives a DST change.
    const d = new Date(fromLocalInput(endsAt) ?? Date.now());
    d.setDate(d.getDate() + days);
    setEndsAt(toLocalInput(d.getTime()));
    setMessage(null);
  }

  function onApprove() {
    // listings.approve keeps any old awards (e.g. awarded -> pending -> approve);
    // admin.setLifecycle to live voting does the same 7-day start and clears them.
    if (listing.awards.length > 0) {
      void run(() => setLifecycle({ id: listing.id, status: "in_voting" }));
    } else {
      void run(() => approve({ id: listing.id }));
    }
  }

  function onApply() {
    if (busy || invalid || nothingToSave) return;
    const args: LifecycleArgs = { id: listing.id, status: target };
    if (target === "in_voting") {
      const ms = fromLocalInput(endsAt);
      if (ms === null || ms <= Date.now()) {
        setError("Pick a voting end in the future.");
        return;
      }
      args.votingEndsAt = ms;
    }
    if (target === "awarded") args.awards = awards;
    if (target === "rejected") args.note = note.trim();
    if (
      listing.awards.length > 0 &&
      (target === "in_voting" || target === "archived") &&
      !confirm(`This removes the current awards (${listing.awards.join(", ")}). Continue?`)
    ) {
      return;
    }
    void run(() => setLifecycle(args));
  }

  return (
    <section className="admin-panel" aria-labelledby="lifecycle-heading">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p id="lifecycle-heading" className="admin-eyebrow">
          Lifecycle
        </p>
        <StatusBadge status={status} />
      </div>

      <dl className="grid gap-3 border-y border-black/10 py-4 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-black/55">Reviewed</dt>
          <dd className="admin-mono text-right">{listing.reviewedAt ? formatDate(listing.reviewedAt) : "—"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-black/55">Published</dt>
          <dd className="admin-mono text-right">{listing.publishedAt ? formatDate(listing.publishedAt) : "—"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-black/55">{status === "in_voting" ? "Voting ends" : "Voting ended"}</dt>
          <dd className="admin-mono text-right">{listing.votingEndsAt ? formatDate(listing.votingEndsAt) : "—"}</dd>
        </div>
        {listing.awardedAt && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-black/55">Awarded</dt>
            <dd className="admin-mono text-right">{formatDate(listing.awardedAt)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-black/55">Awards</dt>
          <dd>
            {listing.awards.length ? <AwardBadges awards={listing.awards} /> : <span className="admin-mono">—</span>}
          </dd>
        </div>
        {status === "rejected" && listing.reviewNote && (
          <div className="grid gap-1">
            <dt className="text-black/55">Reason</dt>
            <dd className="text-xs leading-relaxed">{listing.reviewNote}</dd>
          </div>
        )}
      </dl>

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium">
          {error}
        </p>
      )}

      <div className="mt-5 grid gap-3">
        {(status === "pending" || status === "rejected") && (
          <button type="button" className="admin-button w-full" disabled={busy} onClick={onApprove}>
            Approve: start 7-day voting <span aria-hidden="true">↗</span>
          </button>
        )}
        {status === "in_voting" && (
          <button
            type="button"
            className="admin-button w-full"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  `Close voting for "${listing.title}" now and assign awards automatically from the current score?`,
                )
              ) {
                void run(() => closeVoting({ id: listing.id }));
              }
            }}
          >
            Close voting now &amp; assign awards automatically
          </button>
        )}
        {isPublic && (
          <a
            href={storefrontSiteUrl(listing.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-button admin-button-secondary w-full"
          >
            View on the site <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      <div className="mt-6 grid gap-4 border-t border-black/10 pt-6">
        <div>
          <p className="admin-eyebrow">Set status by hand</p>
          <p className="mt-2 text-xs leading-relaxed text-black/55">
            Manual awards override the automatic rules used when voting closes.
          </p>
        </div>

        <fieldset disabled={busy} className="grid gap-4">
          <legend className="sr-only">Target status</legend>
          <div className="flex flex-wrap gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.status}
                type="button"
                className="admin-toggle"
                aria-pressed={target === t.status}
                onClick={() => {
                  setTarget(t.status);
                  setError(null);
                  setMessage(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-black/55">{targetInfo.hint}</p>

          {target === "in_voting" && (
            <div className="grid gap-2">
              <label htmlFor="voting-ends" className="admin-eyebrow">
                Voting ends
              </label>
              <input
                id="voting-ends"
                type="datetime-local"
                className="admin-input admin-mono"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="admin-toggle admin-toggle-mono" onClick={() => shiftEnd(-1)}>
                  −1 day
                </button>
                <button type="button" className="admin-toggle admin-toggle-mono" onClick={() => shiftEnd(1)}>
                  +1 day
                </button>
                <button
                  type="button"
                  className="admin-toggle admin-toggle-mono"
                  onClick={() => setEndsAt(toLocalInput(Date.now() + VOTING_DAYS * DAY_MS))}
                >
                  Now + {VOTING_DAYS} days
                </button>
              </div>
              <p className="text-xs text-black/55">Your local time. Must be in the future.</p>
            </div>
          )}

          {target === "awarded" && (
            <div className="grid gap-3">
              {AWARDS.map((a) => (
                <label key={a.slug} className="admin-check">
                  <input
                    type="checkbox"
                    checked={awards.includes(a.slug)}
                    onChange={(e) =>
                      setAwards((list) =>
                        e.target.checked ? [...list, a.slug] : list.filter((x) => x !== a.slug),
                      )
                    }
                  />
                  <span>
                    <span className="admin-mono">{a.short}</span> {a.name}
                  </span>
                </label>
              ))}
              {awards.length === 0 && <p className="text-xs text-black/55">Pick at least one award.</p>}
            </div>
          )}

          {target === "rejected" && (
            <label className="grid gap-2">
              <span className="admin-eyebrow">Reason (the owner sees this)</span>
              <textarea
                rows={3}
                maxLength={LIMITS.reviewNote}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. The screenshot doesn't match the live site."
                className="admin-input resize-y"
              />
            </label>
          )}

          <button
            type="button"
            className="admin-button w-full"
            disabled={busy || invalid || nothingToSave}
            onClick={onApply}
          >
            {busy
              ? "Saving…"
              : nothingToSave
                ? `Already ${STATUS_LABEL[status].toLowerCase()}`
                : same
                  ? "Save changes"
                  : `Move to ${targetInfo.label.toLowerCase()}`}
          </button>
          {message && (
            <p role="status" className="text-xs text-black/55">
              {message}
            </p>
          )}
        </fieldset>
      </div>
    </section>
  );
}
