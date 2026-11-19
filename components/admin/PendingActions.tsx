"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { describePending } from "@/lib/pendingActions";
import { showAlert, showError } from "./Alerts";

type Row = FunctionReturnType<typeof api.pendingActions.list>[number];

/**
 * What Claude asked to send or publish through the connector, waiting for an
 * admin (convex/pendingActions.ts). Each request shows exactly what goes out;
 * Approve executes it once, Reject drops it. Nothing renders when nothing waits.
 */
export function PendingActions() {
  const rows = useQuery(api.pendingActions.list, {});
  if (!rows || rows.length === 0) return null;
  return (
    <section aria-labelledby="pending-actions" className="mb-8">
      <p className="admin-eyebrow" id="pending-actions">
        Pending actions · {rows.length} waiting for you
      </p>
      <p className="claim-meta mb-3">
        Claude asked for these through the connector. Nothing has been sent or published yet.
      </p>
      <ul className="request-list">
        {rows.map((row) => (
          <PendingRow key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function PendingRow({ row }: { row: Row }) {
  const approve = useMutation(api.pendingActions.approve);
  const reject = useMutation(api.pendingActions.reject);
  const [busy, setBusy] = useState(false);
  const d = describePending(row);

  async function act(fn: () => Promise<{ message: string }>) {
    setBusy(true);
    try {
      const res = await fn();
      showAlert(res.message, "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="claim-card">
      <div className="claim-card-main">
        <div className="min-w-0">
          <p className="admin-eyebrow">
            {d.label} · asked by {row.requestedBy} via Claude · {new Date(row.createdAt).toLocaleString()}
          </p>
          <h2>{row.summary}</h2>
          {d.problem && (
            <p role="alert" className="claim-meta font-medium">
              {d.problem}
            </p>
          )}
        </div>
      </div>

      <dl className="request-fields">
        {d.facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value || "—"}</dd>
          </div>
        ))}
        {d.texts.map((t) => (
          <div key={t.label} className="wide">
            <dt>{t.label}</dt>
            <dd>
              <span className="whitespace-pre-line">{t.text}</span>
            </dd>
          </div>
        ))}
      </dl>

      {d.media.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Media">
          {d.media.map((m, i) => {
            const label = m.networks?.length ? m.networks.join(", ") : m.kind;
            return m.kind === "image" ? (
              <img key={`${i}-${m.url}`} src={m.url} alt={label} title={label} className="h-24 w-auto rounded-md border border-black/10" loading="lazy" />
            ) : (
              <video key={`${i}-${m.url}`} src={m.url} title={label} muted playsInline className="h-24 w-auto rounded-md border border-black/10" />
            );
          })}
        </div>
      )}

      <div className="claim-actions">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="admin-button"
            disabled={busy || row.changed}
            onClick={() => {
              if (d.confirm && !confirm(d.confirm)) return;
              void act(() => approve({ id: row.id }));
            }}
          >
            Approve
          </button>
          <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={() => act(() => reject({ id: row.id }))}>
            Reject
          </button>
        </div>
      </div>
    </li>
  );
}
