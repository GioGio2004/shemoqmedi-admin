"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ResendEmail, ResendRow } from "@/convex/lib/resendApi";

const PAGE = 50;

/** Delivered/opened/clicked read as good, bounces and complaints as bad, the rest as in flight. */
function tone(event: string | null) {
  if (!event) return "bg-black/5 text-black/60";
  if (["delivered", "opened", "clicked"].includes(event)) return "bg-emerald-50 text-emerald-800";
  if (["bounced", "complained", "failed", "suppressed", "canceled"].includes(event)) return "bg-red-50 text-red-800";
  return "bg-amber-50 text-amber-800";
}

const when = (ms: number) =>
  ms
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tbilisi",
      }).format(ms)
    : "—";

/** "Shemoqmedi <awards@shemoqmedi.space>" → "awards@shemoqmedi.space". */
const address = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;

/** Resend's own log of every email sent from this account, newest first. */
export function EmailLog() {
  const list = useAction(api.resendLog.list);
  const get = useAction(api.resendLog.get);
  const [rows, setRows] = useState<ResendRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ email: ResendEmail | null; error: string | null } | null>(null);

  /** Fetches a page; `after` appends older emails, none replaces the list. State is set only once it answers. */
  const fetchPage = useCallback(
    (after?: string) =>
      list({ limit: PAGE, ...(after ? { after } : {}) })
        .then((page) => {
          setError(page.error);
          setRows((prev) => (after ? [...prev, ...page.rows] : page.rows));
          setHasMore(page.hasMore);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false)),
    [list],
  );

  const load = (after?: string) => {
    setLoading(true);
    void fetchPage(after);
  };

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const toggle = async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setDetail(null);
    try {
      setDetail(await get({ id }));
    } catch (e) {
      setDetail({ email: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.subject, r.from, r.lastEvent ?? "", ...r.to].some((field) => field.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.lastEvent ?? "unknown"] = (c[r.lastEvent ?? "unknown"] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Emails</p>
          <h1>Emails.</h1>
          <p>
            Straight from Resend: every email this account sent, whichever part of the app sent it (awards, voting,
            juror digests, broadcasts, emails Claude sent from chat, and your Gmail send-as mail), with what happened to
            it last. Click one to read it. Times are Tbilisi time.
          </p>
        </div>
        <button type="button" className="admin-button admin-button-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <section className="admin-panel grid gap-5">
        {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipient, subject, sender or status"
            aria-label="Search emails"
            className="min-w-0 flex-1 rounded-full border border-black/10 bg-white px-5 py-3 text-sm"
          />
          {counts.map(([event, n]) => (
            <button
              key={event}
              type="button"
              onClick={() => setSearch(search === event ? "" : event)}
              className={`rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] ${tone(event === "unknown" ? null : event)}`}
            >
              {event} {n}
            </button>
          ))}
        </div>

        {rows.length === 0 && !loading && !error ? <p className="text-sm text-black/55">Nothing sent yet.</p> : null}

        <ul className="grid">
          {shown.map((r) => (
            <li key={r.id} className="border-t border-black/10 first:border-t-0">
              <button
                type="button"
                onClick={() => void toggle(r.id)}
                aria-expanded={open === r.id}
                className="grid w-full gap-1 py-4 text-left md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)_110px] md:items-center md:gap-4"
              >
                <span className="font-mono text-[11px] text-black/55 tabular-nums">{when(r.createdAt)}</span>
                <span className="truncate text-sm font-medium">{r.to.join(", ")}</span>
                <span className="truncate text-sm text-black/70">
                  {r.subject}
                  <span className="ml-2 text-xs text-black/40">{address(r.from)}</span>
                </span>
                <span
                  className={`w-fit rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.06em] md:justify-self-end ${tone(r.lastEvent)}`}
                >
                  {r.lastEvent ?? "—"}
                </span>
              </button>

              {open === r.id ? (
                <div className="mb-5 grid gap-3 rounded-2xl border border-black/10 p-4">
                  {!detail ? (
                    <p className="text-sm text-black/55">Loading…</p>
                  ) : detail.error || !detail.email ? (
                    <p className="text-sm text-red-800">{detail.error ?? "Not found."}</p>
                  ) : (
                    <>
                      <dl className="grid gap-1 text-xs text-black/60 md:grid-cols-[90px_1fr]">
                        <dt>From</dt>
                        <dd>{detail.email.from}</dd>
                        <dt>To</dt>
                        <dd>{detail.email.to.join(", ")}</dd>
                        {detail.email.cc.length ? (
                          <>
                            <dt>Cc</dt>
                            <dd>{detail.email.cc.join(", ")}</dd>
                          </>
                        ) : null}
                        {detail.email.replyTo.length ? (
                          <>
                            <dt>Reply to</dt>
                            <dd>{detail.email.replyTo.join(", ")}</dd>
                          </>
                        ) : null}
                        <dt>Resend id</dt>
                        <dd className="font-mono">{detail.email.id}</dd>
                      </dl>
                      {detail.email.html ? (
                        // Sandboxed with no permissions: no scripts, no navigation, no same-origin access.
                        <iframe
                          title={`Email: ${detail.email.subject}`}
                          srcDoc={detail.email.html}
                          sandbox=""
                          className="h-[560px] w-full rounded-xl border border-black/10 bg-white"
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap text-sm">{detail.email.text ?? "(no body)"}</pre>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {hasMore ? (
          <button
            type="button"
            className="admin-button admin-button-secondary w-fit"
            disabled={loading}
            onClick={() => void load(rows[rows.length - 1]?.id)}
          >
            {loading ? "Loading…" : "Load older"}
          </button>
        ) : null}
      </section>
    </>
  );
}
