"use client";

// The agent desk in the admin: hand listings (or new sites) to the AI agent,
// read its drafts as a before/after, approve, send back with feedback or
// cancel, and undo any change to a listing's copy (convex/editorial.ts).

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, LIMITS } from "@/convex/lib/taxonomy";
import { formatDate } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";
import { safeHref } from "./format";

type Brief = FunctionReturnType<typeof api.editorial.desk>["open"][number];
type Revision = FunctionReturnType<typeof api.editorial.forListing>["revisions"][number];

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  tagline: "Tagline",
  writeup: "About this site",
  categories: "Categories",
  technologies: "Technologies",
  region: "Region",
  creatorTier: "Creator",
  creditName: "Made by",
  creditUrl: "Maker's website",
};

const STATUS_LABEL: Record<Brief["status"], string> = {
  queued: "With the agent",
  drafted: "Draft waiting for you",
  approved: "Approved",
  cancelled: "Cancelled",
};

const CATEGORY_NAME = new Map<string, string>(CATEGORIES.map((c) => [c.slug, c.name]));

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    return field === "categories" ? value.map((v) => CATEGORY_NAME.get(String(v)) ?? String(v)).join(", ") : value.join(", ");
  }
  if (field === "region") return value === "georgia" ? "Georgia" : "Global";
  if (field === "creatorTier") return value === "solo" ? "Solo" : "Studio / agency";
  return String(value);
}

/** Multi-paragraph text with its blank-line paragraphs kept. */
function Paragraphs({ text }: { text: string }) {
  return (
    <div className="grid gap-3">
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className="text-sm leading-relaxed">
          {p}
        </p>
      ))}
    </div>
  );
}

function Change({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  const long = field === "writeup";
  return (
    <div className="grid gap-2 border-t border-black/10 pt-4">
      <p className="admin-eyebrow">{FIELD_LABEL[field] ?? field}</p>
      {long ? (
        <>
          <Paragraphs text={String(after ?? "")} />
          {before ? (
            <details className="text-xs text-black/55">
              <summary className="cursor-pointer">Current text</summary>
              <div className="mt-2">
                <Paragraphs text={String(before)} />
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <p className="text-sm leading-relaxed">
          {before !== null && <span className="text-black/45 line-through">{show(field, before)}</span>}
          {before !== null && <span aria-hidden="true"> → </span>}
          <span>{show(field, after)}</span>
        </p>
      )}
    </div>
  );
}

/** One brief: what Giorgi asked, the agent's draft as a before/after, and the decisions. */
export function BriefCard({ brief, showSite = true }: { brief: Brief; showSite?: boolean }) {
  const approve = useMutation(api.editorial.approve);
  const sendBack = useMutation(api.editorial.sendBack);
  const cancel = useMutation(api.editorial.cancel);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const open = brief.status === "queued" || brief.status === "drafted";
  const liveHref = safeHref(brief.url);

  async function act(fn: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      showAlert(done, "success");
      setFeedback("");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="admin-panel grid gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <p className="admin-eyebrow">{STATUS_LABEL[brief.status]}</p>
          {showSite && (
            <h3 className="text-lg font-semibold tracking-tight">
              {brief.listing ? (
                <Link href={`/review/${brief.listing.id}`} className="hover:underline">
                  {brief.listing.title}
                </Link>
              ) : (
                <>New site: {brief.draft?.title ?? brief.url}</>
              )}
            </h3>
          )}
          {liveHref && (
            <a href={liveHref} target="_blank" rel="noopener noreferrer" className="admin-text-link text-xs">
              {brief.url} ↗
            </a>
          )}
        </div>
        <p className="text-xs text-black/55">
          {brief.rounds > 0 && `Draft ${brief.rounds} · `}
          {formatDate(brief.updatedAt)}
        </p>
      </div>

      {brief.note && (
        <p className="text-sm leading-relaxed">
          <span className="admin-eyebrow mr-2">Your note</span>
          {brief.note}
        </p>
      )}
      {brief.feedback && brief.status === "queued" && (
        <p className="text-sm leading-relaxed">
          <span className="admin-eyebrow mr-2">Sent back</span>
          {brief.feedback}
        </p>
      )}

      {brief.status === "queued" && brief.rounds === 0 && (
        <p className="text-sm text-black/55">
          Waiting for the agent. Ask Claude &ldquo;what&apos;s on the listing desk?&rdquo; to start it.
        </p>
      )}

      {brief.draft && brief.status !== "cancelled" && (
        <div className="grid gap-4">
          {brief.changes.length === 0 ? (
            <p className="text-sm text-black/55">The draft matches the listing as it is.</p>
          ) : (
            brief.changes.map((c) => <Change key={c.field} field={c.field} before={c.before} after={c.after} />)
          )}
          {brief.writeupWords !== null && (
            <p className="admin-mono text-xs text-black/55">Write-up: {brief.writeupWords} words</p>
          )}
          {brief.agentNote && (
            <p className="text-sm leading-relaxed">
              <span className="admin-eyebrow mr-2">Agent&apos;s note</span>
              {brief.agentNote}
            </p>
          )}
          {brief.sources.length > 0 && (
            <details className="text-xs text-black/55">
              <summary className="cursor-pointer">Sources ({brief.sources.length})</summary>
              <ul className="mt-2 grid gap-1">
                {brief.sources.map((s) => (
                  <li key={s}>
                    <a href={safeHref(s) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {brief.status === "approved" && !brief.listing && (
        <Link href={`/listings/new?brief=${brief.id}`} className="admin-button justify-self-start">
          Add screenshots and create the listing
        </Link>
      )}

      {open && (
        <div className="grid gap-3 border-t border-black/10 pt-4">
          {brief.status === "drafted" && (
            <button
              type="button"
              className="admin-button justify-self-start"
              disabled={busy}
              onClick={() => act(() => approve({ briefId: brief.id }), brief.listing ? "Applied to the listing." : "Approved. Add its screenshots next.")}
            >
              {brief.listing ? "Approve and apply" : "Approve"}
            </button>
          )}
          {brief.status === "drafted" && (
            <label className="grid gap-2">
              <span className="admin-eyebrow">Send back with feedback</span>
              <textarea
                className="admin-input resize-y"
                rows={2}
                maxLength={LIMITS.briefNote}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What to change, e.g. say more about the type, drop the second paragraph."
              />
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            {brief.status === "drafted" && (
              <button
                type="button"
                className="admin-button admin-button-secondary"
                disabled={busy || !feedback.trim()}
                onClick={() => act(() => sendBack({ briefId: brief.id, feedback }), "Sent back to the agent.")}
              >
                Send back
              </button>
            )}
            <button
              type="button"
              className="admin-button admin-button-secondary"
              disabled={busy}
              onClick={() => {
                if (confirm("Take this brief off the desk? Nothing on the listing changes.")) {
                  void act(() => cancel({ briefId: brief.id }), "Cancelled.");
                }
              }}
            >
              Cancel brief
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function HandToAgent({ listingId }: { listingId: Id<"listings"> }) {
  const queue = useMutation(api.editorial.queueListing);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await queue({ listingId, note: note.trim() || undefined });
          setNote("");
          showAlert("Handed to the agent.", "success");
        } catch (err) {
          showError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        className="admin-input resize-y"
        rows={2}
        maxLength={LIMITS.briefNote}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the agent, e.g. focus on the 3D kitchen."
      />
      <button type="submit" className="admin-button justify-self-start" disabled={busy}>
        Hand to agent
      </button>
    </form>
  );
}

function History({ revisions }: { revisions: Revision[] }) {
  const undo = useMutation(api.editorial.undo);
  const [busy, setBusy] = useState(false);
  if (revisions.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="admin-eyebrow cursor-pointer">Change history ({revisions.length})</summary>
      <ul className="mt-3 grid gap-3">
        {revisions.map((r) => (
          <li key={r.id} className="grid gap-1 border-t border-black/10 pt-3">
            <p className="text-black/55">
              {formatDate(r.createdAt)} · {r.source === "agent" ? "Agent draft" : r.source === "undo" ? "Undo" : "Admin edit"} ·{" "}
              {r.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}
            </p>
            {r.undoneAt ? (
              <p className="text-black/45">Undone {formatDate(r.undoneAt)}</p>
            ) : (
              <button
                type="button"
                className="admin-text-link justify-self-start"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Put these fields back as they were before this change?")) return;
                  setBusy(true);
                  try {
                    await undo({ revisionId: r.id });
                    showAlert("Undone.", "success");
                  } catch (err) {
                    showError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Undo this change
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The listing page's agent panel: hand it to the agent, decide on its draft, undo changes. */
export function AgentPanel({ listingId }: { listingId: Id<"listings"> }) {
  const data = useQuery(api.editorial.forListing, { listingId });
  if (data === undefined) return null;
  const open = data.brief && (data.brief.status === "queued" || data.brief.status === "drafted") ? data.brief : null;
  return (
    <section className="grid gap-4" aria-labelledby="agent-heading">
      <p id="agent-heading" className="admin-eyebrow">
        Agent desk
      </p>
      {open ? (
        <BriefCard brief={open} showSite={false} />
      ) : (
        <div className="admin-panel grid gap-4">
          <p className="text-sm leading-relaxed text-black/55">
            Hand this listing to your AI agent: it researches the live site and drafts the title, tagline, the
            &ldquo;About this site&rdquo; write-up and the details. Nothing changes until you approve.
          </p>
          <HandToAgent listingId={listingId} />
        </div>
      )}
      <History revisions={data.revisions} />
    </section>
  );
}

function NewSiteForm() {
  const queue = useMutation(api.editorial.queueNewSite);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="admin-panel grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !url.trim()) return;
        setBusy(true);
        try {
          await queue({ url: url.trim(), note: note.trim() || undefined });
          setUrl("");
          setNote("");
          showAlert("Handed to the agent.", "success");
        } catch (err) {
          showError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="admin-eyebrow">Hand a new site to the agent</p>
      <input
        className="admin-input"
        type="url"
        required
        placeholder="https://site-to-list.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <textarea
        className="admin-input resize-y"
        rows={2}
        maxLength={LIMITS.briefNote}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the agent."
      />
      <button type="submit" className="admin-button justify-self-start" disabled={busy}>
        Hand to agent
      </button>
      <p className="text-xs leading-relaxed text-black/55">
        The agent drafts every field. After you approve, you add the screenshots and video and create the listing.
      </p>
    </form>
  );
}

/** /agent: the whole desk. */
export function AgentDeskPage() {
  const desk = useQuery(api.editorial.desk, {});
  const drafted = desk?.open.filter((b) => b.status === "drafted") ?? [];
  const queued = desk?.open.filter((b) => b.status === "queued") ?? [];
  const ready = desk?.recent.filter((b) => b.status === "approved" && !b.listing) ?? [];
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Agent desk</p>
          <h1>Listing desk</h1>
          <p>
            Sites you handed to your AI agent. It researches each one and drafts its page; nothing changes on the site
            until you approve. Open a listing to hand it over, or add a new site here.
          </p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-6">
          {desk === undefined ? (
            <p className="admin-eyebrow">Loading…</p>
          ) : drafted.length + queued.length + ready.length === 0 ? (
            <div className="admin-empty">
              <h2>The desk is empty.</h2>
              Hand a listing to the agent from its page, or add a new site.
            </div>
          ) : (
            <>
              {drafted.map((b) => (
                <BriefCard key={b.id} brief={b} />
              ))}
              {ready.map((b) => (
                <BriefCard key={b.id} brief={b} />
              ))}
              {queued.map((b) => (
                <BriefCard key={b.id} brief={b} />
              ))}
            </>
          )}
        </div>
        <aside className="grid content-start gap-6">
          <NewSiteForm />
        </aside>
      </div>
    </>
  );
}
