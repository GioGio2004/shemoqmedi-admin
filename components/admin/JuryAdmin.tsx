"use client";

import { showError } from "./Alerts";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate, STOREFRONT_URL } from "@/lib/storefront";

type Overview = FunctionReturnType<typeof api.jury.adminOverview>;
type SendResult = { link: string; sent: boolean; error: string | null };

const STATUS_LABEL: Record<Overview["invites"][number]["status"], string> = {
  pending: "Waiting",
  accepted: "Joined",
  revoked: "Revoked",
  expired: "Expired",
};

/** Clerk photo, or the grey placeholder when the juror has none. */
export function JurorAvatar({ url, name, size = 44 }: { url: string | null; name: string; size?: number }) {
  return url ? (
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-black/10 text-black/40"
      style={{ width: size, height: size }}
      title={name}
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6z" />
      </svg>
    </span>
  );
}

function SendNote({ result }: { result: SendResult }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="grid gap-2 rounded-2xl border border-black/10 p-4 text-sm">
      <p className="font-medium">
        {result.sent ? "Invitation sent." : "The invitation was saved but the email was not sent."}
      </p>
      {result.error && <p className="text-xs text-black/60">{result.error}</p>}
      <p className="text-xs text-black/60">
        Invitation link (shown only now; resending makes a new one):
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="admin-mono min-w-0 flex-1 break-all text-xs">{result.link}</code>
        <button
          type="button"
          className="admin-button admin-button-secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(result.link);
              setCopied(true);
            } catch {
              // Clipboard blocked: the link stays selectable.
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function InviteForm() {
  const invite = useAction(api.jury.invite);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await invite({ name: name.trim(), email: email.trim(), note: note.trim() || undefined }));
      setName("");
      setEmail("");
      setNote("");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel grid gap-5" aria-labelledby="invite-heading">
      <p id="invite-heading" className="admin-eyebrow">
        Invite a juror
      </p>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="admin-eyebrow">Name</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="admin-input" placeholder="Ana Beridze" />
          </label>
          <label className="grid gap-2">
            <span className="admin-eyebrow">Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="admin-input"
              placeholder="ana@studio.ge"
              autoComplete="off"
            />
          </label>
        </div>
        <label className="grid gap-2">
          <span className="admin-eyebrow">Personal note (optional, in the email)</span>
          <textarea
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="admin-input resize-y"
            placeholder="We loved your work on …"
          />
        </label>
        <p className="text-xs text-black/55">
          The email goes out through Resend with a single-use link that works for 14 days. Only an account with this
          email address can accept it.
        </p>
        <div>
          <button type="submit" className="admin-button" disabled={busy || !name.trim() || !email.trim()}>
            {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>
      {result && <SendNote result={result} />}
    </section>
  );
}

function InviteRow({ invite }: { invite: Overview["invites"][number] }) {
  const resend = useAction(api.jury.resendInvite);
  const revoke = useMutation(api.jury.revokeInvite);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const open = invite.status === "pending" || invite.status === "expired";

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-3 border-t border-black/10 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{invite.name}</p>
          <p className="admin-mono text-xs text-black/60">{invite.email}</p>
          <p className="text-xs text-black/55">
            {STATUS_LABEL[invite.status]} · invited {formatDate(invite.createdAt)}
            {invite.invitedBy ? ` by ${invite.invitedBy}` : ""}
            {invite.status === "pending" ? ` · link valid until ${formatDate(invite.expiresAt)}` : ""}
          </p>
          {invite.sendError && invite.status === "pending" && (
            <p className="text-xs font-medium">Not emailed: {invite.sendError}</p>
          )}
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="admin-button admin-button-secondary"
              disabled={busy}
              onClick={() => run(async () => setResult(await resend({ inviteId: invite.id })))}
            >
              Resend
            </button>
            {invite.status === "pending" && (
              <button
                type="button"
                className="admin-button admin-button-secondary"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Revoke the invitation for ${invite.email}? The link stops working.`)) {
                    void run(async () => {
                      await revoke({ inviteId: invite.id });
                    });
                  }
                }}
              >
                Revoke
              </button>
            )}
          </div>
        )}
      </div>
      {result && <SendNote result={result} />}
    </li>
  );
}

function JurorRow({ juror }: { juror: Overview["jurors"][number] }) {
  const setActive = useMutation(api.jury.setJurorActive);
  const [busy, setBusy] = useState(false);

  async function toggle(id: Id<"jurors">, active: boolean) {
    if (!active && !confirm(`Take ${juror.name} off the jury? Their evaluations stay on the sites.`)) return;
    setBusy(true);
    try {
      await setActive({ jurorId: id, active });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-4 border-t border-black/10 py-4 first:border-t-0">
      <JurorAvatar url={juror.imageUrl} name={juror.name} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {juror.name} {!juror.active && <span className="text-xs text-black/55">(off the jury)</span>}
        </p>
        <p className="text-sm text-black/70">
          {juror.title}
          {juror.location ? ` · ${juror.location}` : ""}
        </p>
        <p className="admin-mono text-xs text-black/55">
          {juror.email ?? "account deleted"} · {juror.evaluations} {juror.evaluations === 1 ? "evaluation" : "evaluations"}{" "}
          · joined {formatDate(juror.joinedAt)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {juror.active && (
          <a
            href={`${STOREFRONT_URL}/jury#${juror.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-button admin-button-secondary"
          >
            View
          </a>
        )}
        <button
          type="button"
          className="admin-button admin-button-secondary"
          disabled={busy}
          onClick={() => toggle(juror.id, !juror.active)}
        >
          {juror.active ? "Remove from jury" : "Restore"}
        </button>
      </div>
    </li>
  );
}

export function JuryAdmin() {
  const data = useQuery(api.jury.adminOverview, {});

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Jury</p>
          <h1>Jury.</h1>
          <p>
            Invite the people you want on the jury. They accept by email link, set up their profile and photo on the
            site, then evaluate sites in their voting week with the Evaluate button on each listing page. A site&apos;s
            jury score is the average of its evaluations.
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        <InviteForm />

        <section className="admin-panel" aria-labelledby="jurors-heading">
          <p id="jurors-heading" className="admin-eyebrow mb-3">
            Jurors {data ? `(${data.jurors.filter((j) => j.active).length})` : ""}
          </p>
          {data === undefined ? (
            <p className="text-sm text-black/55">Loading…</p>
          ) : data.jurors.length === 0 ? (
            <p className="text-sm text-black/55">Nobody has joined yet.</p>
          ) : (
            <ul>
              {data.jurors.map((j) => (
                <JurorRow key={j.id} juror={j} />
              ))}
            </ul>
          )}
        </section>

        <section className="admin-panel" aria-labelledby="invites-heading">
          <p id="invites-heading" className="admin-eyebrow mb-3">
            Invitations
          </p>
          {data === undefined ? (
            <p className="text-sm text-black/55">Loading…</p>
          ) : data.invites.length === 0 ? (
            <p className="text-sm text-black/55">No invitations yet.</p>
          ) : (
            <ul>
              {data.invites.map((i) => (
                <InviteRow key={i.id} invite={i} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
