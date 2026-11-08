"use client";

import { showAlert, showError } from "./Alerts";
import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// Secret claim links (convex/claimLinks.ts). The link is minted on the first
// copy and stays the same until "New link" rotates it.

export type ClaimTarget = FunctionArgs<typeof api.claimLinks.link>["target"];

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard blocked (permissions, or the click's activation expired): the URL stays selectable.
    return false;
  }
}

/** A URL in mono with a Copy button. Stays selectable when the clipboard is blocked. */
export function CopyUrl({ url, label = "Copy" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <code className="admin-mono min-w-0 flex-1 break-all text-xs select-all" style={{ textTransform: "none" }}>
        {url}
      </code>
      <button
        type="button"
        className="admin-button admin-button-secondary"
        onClick={async () => setCopied(await copyText(url))}
      >
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

/**
 * "Copy claim link" for an unclaimed juror or listing: mints the link on
 * first use, then copies it. `token` (from the query) only says whether a
 * link exists yet. `rotatable` adds "New link", which kills the old one.
 */
export function ClaimLink({
  target,
  token,
  rotatable = false,
}: {
  target: ClaimTarget;
  token?: string | null;
  rotatable?: boolean;
}) {
  const link = useAction(api.claimLinks.link);
  const [busy, setBusy] = useState(false);
  // Shown when the clipboard refused, or after a rotate so the new URL is visible.
  const [shown, setShown] = useState<string | null>(null);

  async function run(rotate: boolean) {
    if (busy) return;
    if (rotate && !confirm("Make a new claim link? The old link stops working.")) return;
    setBusy(true);
    try {
      const { url } = await link({ target, rotate });
      const copied = await copyText(url);
      setShown(copied && !rotate ? null : url);
      if (copied) showAlert(rotate ? "New claim link copied." : "Claim link copied.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={() => run(false)}>
          {busy ? "Working…" : "Copy claim link"}
        </button>
        {rotatable && token && (
          <button type="button" className="admin-text-link" disabled={busy} onClick={() => run(true)}>
            New link
          </button>
        )}
        {!token && !shown && <span className="text-xs text-black/55">No link yet. Copying makes one.</span>}
      </div>
      {shown && <CopyUrl url={shown} />}
    </div>
  );
}

type EmailResult = { url: string; sent: boolean; error: string | null };

/** "Email link" for an unclaimed juror: sends their claim link through Resend. */
export function EmailClaimLink({
  jurorId,
  email,
  name,
}: {
  jurorId: Id<"jurors">;
  email: string | null;
  name: string;
}) {
  const send = useAction(api.claimLinks.emailJuror);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EmailResult | null>(null);

  async function onClick() {
    if (busy || !email) return;
    if (!confirm(`Email ${name}'s claim link to ${email}?`)) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await send({ jurorId }));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="admin-button admin-button-secondary"
          disabled={busy || !email}
          onClick={onClick}
        >
          {busy ? "Sending…" : "Email link"}
        </button>
        {!email && <span className="text-xs text-black/55">Add an email to the profile to send it.</span>}
      </div>
      {result && (
        <div role="status" className="grid gap-2 rounded-2xl border border-black/10 p-4 text-sm">
          <p className="font-medium">{result.sent ? `Sent to ${email}.` : "The email was not sent."}</p>
          {result.error && <p className="text-xs text-black/60">{result.error}</p>}
          <CopyUrl url={result.url} label="Copy link" />
        </div>
      )}
    </div>
  );
}
