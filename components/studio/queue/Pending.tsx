"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import { describePending } from "@/lib/pendingActions";

type Row = FunctionReturnType<typeof api.pendingActions.list>[number];

/**
 * The Studio's side of the connector's human gate (convex/pendingActions.ts):
 * emails, broadcasts and publishes Claude asked for, above the queue, each
 * with what goes out and Approve / Reject. Hidden when nothing waits.
 */
export function StudioPending() {
  const rows = useQuery(api.pendingActions.list, {});
  if (!rows || rows.length === 0) return null;
  return (
    <section className="st-pending st-in" aria-labelledby="st-pending-title">
      <h2 id="st-pending-title" className="st-pending-title">
        Pending <span>{rows.length}</span>
      </h2>
      <p className="st-pending-lede">Claude asked for these. Nothing has gone out yet.</p>
      <div className="st-pending-list">
        {rows.map((row) => (
          <PendingCard key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

function PendingCard({ row }: { row: Row }) {
  const approve = useMutation(api.pendingActions.approve);
  const reject = useMutation(api.pendingActions.reject);
  const [busy, setBusy] = useState(false);
  const d = describePending(row);

  async function act(fn: () => Promise<{ message: string }>) {
    setBusy(true);
    try {
      showAlert((await fn()).message, "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="st-card st-pending-card">
      <p className="st-pending-kind">{d.label}</p>
      <h3 className="st-pending-summary">{row.summary}</h3>
      {d.problem && (
        <p className="st-callout" data-tone="error" role="alert">
          {d.problem}
        </p>
      )}
      <dl className="st-pending-facts">
        {d.facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value || "—"}</dd>
          </div>
        ))}
      </dl>
      {d.texts.map((t) => (
        <details key={t.label} className="st-pending-text">
          <summary>{t.label}</summary>
          <p>{t.text}</p>
        </details>
      ))}
      {d.media.length > 0 && (
        <div className="st-pending-media" aria-label="Media">
          {d.media.map((m, i) =>
            m.kind === "image" ? (
              <img key={`${i}-${m.url}`} src={m.url} alt="" loading="lazy" />
            ) : (
              <video key={`${i}-${m.url}`} src={m.url} muted playsInline />
            ),
          )}
        </div>
      )}
      <div className="st-queue-actions">
        <button
          type="button"
          className="st-btn st-btn-sm"
          disabled={busy || row.changed}
          onClick={() => {
            if (d.confirm && !window.confirm(d.confirm)) return;
            void act(() => approve({ id: row.id }));
          }}
        >
          Approve
        </button>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" disabled={busy} onClick={() => act(() => reject({ id: row.id }))}>
          Reject
        </button>
      </div>
    </article>
  );
}
