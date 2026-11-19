"use client";

import { showAlert, showError } from "./Alerts";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// Secret claim links (convex/claimLinks.ts). Only a hash of each link is
// stored, so a link is shown once, when it is made: copy it then. Each copy
// makes a new link (older ones keep working until they expire, 14 days);
// "Revoke and make new" kills the older ones first.

export type ClaimTarget = FunctionArgs<typeof api.claimLinks.link>["target"];

/** What the queries say about a target's links: when the newest open one expires (null expiresAt: an old plaintext link). */
export type ClaimLinkStatus = { expiresAt: number | null } | null;

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

function statusText(status: ClaimLinkStatus) {
  if (!status) return "No open link.";
  if (status.expiresAt === null) return "An older link is open (no expiry until the claim-link migration runs).";
  return `An open link expires ${new Date(status.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`;
}

/**
 * "Copy new claim link" for an unclaimed juror or listing: makes a link,
 * copies it and shows it this once. `status` (from the query) says whether
 * an open link exists. `rotatable` adds "Revoke and make new", which kills
 * every earlier link first.
 */
export function ClaimLink({
  target,
  status,
  rotatable = false,
}: {
  target: ClaimTarget;
  status?: ClaimLinkStatus;
  rotatable?: boolean;
}) {
  const link = useAction(api.claimLinks.link);
  const [busy, setBusy] = useState(false);
  // The link just made: it can't be read back later.
  const [shown, setShown] = useState<string | null>(null);

  async function run(rotate: boolean) {
    if (busy) return;
    if (rotate && !confirm("Revoke every earlier claim link and make a new one? Links already sent stop working.")) return;
    setBusy(true);
    try {
      const { url } = await link({ target, rotate });
      const copied = await copyText(url);
      setShown(url);
      if (copied) showAlert(rotate ? "New claim link copied. Older links are revoked." : "Claim link copied.", "success");
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
          {busy ? "Working…" : "Copy new claim link"}
        </button>
        {rotatable && status && (
          <button type="button" className="admin-text-link" disabled={busy} onClick={() => run(true)}>
            Revoke and make new
          </button>
        )}
      </div>
      {!shown && <span className="text-xs text-black/55">{statusText(status ?? null)}</span>}
      {shown && (
        <>
          <CopyUrl url={shown} />
          <span className="text-xs text-black/55">Shown once: it can&apos;t be read back later. Works once, for 14 days.</span>
        </>
      )}
    </div>
  );
}

/**
 * "Take claim back" for a claimed listing or jury profile: clears the owner
 * (claimLinks.unclaim) so a new claim link can hand it to the right person.
 */
export function UnclaimButton({ target, label = "Take claim back" }: { target: ClaimTarget; label?: string }) {
  const unclaim = useMutation(api.claimLinks.unclaim);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    const reason = prompt(
      "Take this back from the account that claimed it? It becomes unclaimed again; send a new claim link to the right person. Reason (optional, for the audit log):",
      "",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      await unclaim({ target, reason: reason || undefined });
      showAlert("Claim taken back. It is unclaimed again.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={onClick}>
      {busy ? "Working…" : label}
    </button>
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
