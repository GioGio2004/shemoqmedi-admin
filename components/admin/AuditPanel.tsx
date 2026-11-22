"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showAlert, showError } from "./Alerts";

type Scores = { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };

const CATEGORIES: { key: keyof Scores; label: string }[] = [
  { key: "performance", label: "Performance" },
  { key: "accessibility", label: "Accessibility" },
  { key: "bestPractices", label: "Best practices" },
  { key: "seo", label: "SEO" },
];

const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

function ScoreRow({ label, scores }: { label: string; scores: Scores | undefined }) {
  return (
    <div className="grid grid-cols-[5.5rem_repeat(4,minmax(0,1fr))] items-baseline gap-2">
      <span className="admin-eyebrow">{label}</span>
      {CATEGORIES.map((c) => (
        <span key={c.key} className="admin-mono text-right text-lg tabular-nums" title={c.label}>
          {scores?.[c.key] ?? "—"}
        </span>
      ))}
    </div>
  );
}

/**
 * Technical audit (Google PageSpeed Insights / Lighthouse) on the review page.
 * "Run audit" checks the site on mobile and desktop (about a minute); jurors
 * then see the full report in their Evaluate tool on the site.
 */
export function AuditPanel({ listingId, url }: { listingId: Id<"listings">; url: string }) {
  const audit = useQuery(api.audits.forListing, { listingId });
  const request = useMutation(api.audits.request);
  const [busy, setBusy] = useState(false);
  const running = audit?.status === "running";

  async function run() {
    if (busy || running) return;
    setBusy(true);
    try {
      await request({ listingId });
      showAlert("Audit started. It takes about a minute.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel grid gap-5" aria-labelledby="audit-heading">
      <div className="flex items-baseline justify-between gap-3">
        <p id="audit-heading" className="admin-eyebrow">
          Technical audit
        </p>
        {audit?.finishedAt && !running && <span className="admin-eyebrow">{ago(audit.finishedAt)}</span>}
      </div>

      {audit === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : audit === null ? (
        <p className="text-sm opacity-70">
          Not audited yet. Run it before the site goes to the jury: they see the report in their Evaluate tool.
        </p>
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-[5.5rem_repeat(4,minmax(0,1fr))] gap-2">
            <span />
            {CATEGORIES.map((c) => (
              <span key={c.key} className="admin-eyebrow truncate text-right" title={c.label}>
                {c.key === "bestPractices" ? "Best pr." : c.label.slice(0, 5)}
              </span>
            ))}
          </div>
          <ScoreRow label="Mobile" scores={audit.mobile?.scores} />
          <ScoreRow label="Desktop" scores={audit.desktop?.scores} />
          {audit.status === "error" && audit.error && (
            <p role="alert" className="text-sm font-medium">
              {audit.error}
            </p>
          )}
          {audit.status === "done" && audit.error && (
            <p className="text-sm opacity-70">Partly failed: {audit.error}</p>
          )}
          {(audit.mobile?.opportunities.length ?? 0) > 0 && (
            <p className="text-sm opacity-70">
              Biggest mobile saving: {audit.mobile!.opportunities[0].title} (
              {(audit.mobile!.opportunities[0].savingsMs / 1000).toFixed(1)} s)
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void run()} disabled={busy || running} className="admin-button">
          {running ? "Auditing… (about a minute)" : audit ? "Run audit again" : "Run audit"}
        </button>
        <a
          href={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="admin-button admin-button-secondary"
        >
          Full report on Google
        </a>
      </div>
    </section>
  );
}
