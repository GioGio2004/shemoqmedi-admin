"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";

/**
 * Award eligibility on the review page: the "By the Shemoqmedi team" switch
 * (never eligible; marking it revokes its awards, logged) and the jurors with
 * a conflict of interest on this site (their scores don't count).
 */
export function IntegrityPanel({ listingId, byTeam, title }: { listingId: Id<"listings">; byTeam: boolean; title: string }) {
  const setTeam = useMutation(api.awards.setTeamSite);
  const data = useQuery(api.conflicts.forListing, { listingId });
  const setConflict = useMutation(api.conflicts.set);
  const removeConflict = useMutation(api.conflicts.remove);
  const [jurorId, setJurorId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      showAlert(done, "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel grid gap-5" aria-labelledby="integrity-heading">
      <p id="integrity-heading" className="admin-eyebrow">
        Award eligibility
      </p>

      <label className="admin-check">
        <input
          type="checkbox"
          checked={byTeam}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            if (next && !confirm(`Mark “${title}” as built by the Shemoqmedi team? It can never win an award, and its current awards are revoked (logged).`)) {
              return;
            }
            void run(
              () => setTeam({ listingId, byTeam: next }),
              next ? "Marked as a Shemoqmedi team site." : "No longer a team site.",
            );
          }}
        />
        <span>
          By the Shemoqmedi team <span className="block text-xs text-black/55">Shown on the site; never eligible for awards.</span>
        </span>
      </label>

      <div className="grid gap-3 border-t border-black/10 pt-5">
        <p className="text-sm font-semibold">Conflicts of interest</p>
        <p className="text-xs leading-relaxed text-black/55">
          Jurors who built this site or work for its company. Their scores are removed and they can&apos;t score it. Jurors
          can also declare one themselves.
        </p>
        {data === undefined ? (
          <p className="text-xs text-black/55">Loading…</p>
        ) : (
          <>
            {data.conflicts.length > 0 && (
              <ul className="grid gap-2">
                {data.conflicts.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-black/10 p-3 text-sm">
                    <span>
                      <span className="font-medium">{c.jurorName}</span>
                      <span className="block text-xs text-black/55">
                        {c.reason} · {c.declaredBy === "juror" ? "declared by the juror" : "set by an admin"} · {formatDate(c.createdAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs underline underline-offset-4"
                      disabled={busy}
                      onClick={() => void run(() => removeConflict({ id: c.id }), "Conflict cleared.")}
                    >
                      Clear
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {data.jurors.length > 0 && (
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!jurorId || !reason.trim()) return;
                  void run(
                    () => setConflict({ listingId, jurorId: jurorId as Id<"jurors">, reason: reason.trim() }),
                    "Conflict flagged.",
                  ).then(() => {
                    setJurorId("");
                    setReason("");
                  });
                }}
              >
                <select className="admin-input" value={jurorId} onChange={(e) => setJurorId(e.target.value)} aria-label="Juror">
                  <option value="">Flag a juror…</option>
                  {data.jurors.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                </select>
                <input className="admin-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (e.g. works at the studio)" />
                <button type="submit" className="admin-toggle justify-self-start" disabled={busy || !jurorId || !reason.trim()}>
                  Flag conflict
                </button>
              </form>
            )}
          </>
        )}
      </div>

      <Link href="/awards" className="text-xs underline underline-offset-4">
        Give or revoke awards on the Awards page
      </Link>
    </section>
  );
}
