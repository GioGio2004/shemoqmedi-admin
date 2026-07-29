"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, MonitorOff, RefreshCw } from "lucide-react";
import type { PreviewViewport } from "./MenuPreview";

// ─────────────────────────────────────────────────────────────────────────────
// LiveFrame — the REAL menu page in an iframe, framed exactly like the draft
// preview. What you see here is byte-for-byte what a diner sees: the actual
// /{locale}/menu/{slug} route of the consumer app.
//
// Origins, in preference order:
//   1. NEXT_PUBLIC_MENU_ORIGIN (explicit override)
//   2. the local consumer dev server — shows unpublished edits instantly
//   3. the published site — so the preview still works with nothing running
//      locally (this is the normal case for a venue manager)
//
// Port note: 3005, not 3001 — on this machine OpenBuildsCONTROL holds IPv6
// :::3001, which makes Node's bind fail with EADDRINUSE.
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_ORIGIN =
  process.env.NEXT_PUBLIC_MENU_ORIGIN ?? "http://localhost:3005";

/** Canonical published origin (shemoqmedi.space 307s to www). */
export const PUBLISHED_ORIGIN = "https://www.shemoqmedi.space";

/** Local dev server is only worth probing while developing. */
export const MENU_ORIGIN =
  process.env.NODE_ENV === "development" ? LOCAL_ORIGIN : PUBLISHED_ORIGIN;

export function menuUrl(
  slug: string,
  locale: string,
  origin: string = MENU_ORIGIN,
): string {
  return `${origin}/${locale}/menu/${slug}`;
}

const DESKTOP_W = 1024;
const DESKTOP_H = 640;

/** Shown only when BOTH the local dev server and the published site fail. */
function OriginDown({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0B0B0A] px-8 text-center">
      <MonitorOff className="h-7 w-7 text-v-faint" />
      <p className="text-sm font-medium text-v-ink">
        Live menu isn&apos;t reachable
      </p>
      <p className="text-xs leading-relaxed text-v-mut">
        Neither your local menu server nor the published site responded. Check
        your connection, or switch the preview to Draft.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2 text-xs text-v-mut transition-colors hover:text-v-ink"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </button>
    </div>
  );
}

/** Tells the user WHICH menu they're looking at — local edits vs published. */
function SourceBadge({ origin }: { origin: string }) {
  const isLocal = origin.includes("localhost");
  return (
    <span
      className={`v-t-micro rounded-full border px-2.5 py-1 backdrop-blur ${
        isLocal
          ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300"
          : "border-white/10 bg-white/[0.06] text-v-mut"
      }`}
    >
      {isLocal
        ? "Local menu — unpublished edits included"
        : "Published site — start the local menu server to preview unpublished edits"}
    </span>
  );
}

export function LiveFrame({
  slug,
  locale,
  viewport,
  reloadKey,
  onRetry,
}: {
  slug: string;
  locale: string;
  viewport: PreviewViewport;
  reloadKey: number;
  onRetry: () => void;
}) {
  const isDesktop = viewport === "desktop";

  // Resolve which origin can actually serve the menu: prefer the local dev
  // server (shows unpublished edits), fall back to the published site so the
  // preview still works with nothing running locally. `no-cors` resolves as
  // long as the server answers at all.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const reachable = (url: string) =>
      fetch(url, { mode: "no-cors", cache: "no-store" })
        .then(() => true)
        .catch(() => false);

    (async () => {
      if (MENU_ORIGIN !== PUBLISHED_ORIGIN && (await reachable(MENU_ORIGIN))) {
        if (!cancelled) setOrigin(MENU_ORIGIN);
        return;
      }
      const ok = await reachable(PUBLISHED_ORIGIN);
      if (!cancelled) setOrigin(ok ? PUBLISHED_ORIGIN : "");
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const src = origin ? menuUrl(slug, locale, origin) : "";
  const resolving = origin === null;
  const allDown = origin === "";

  // Desktop frame scales down to fit its container (same as the draft frame).
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!isDesktop) return;
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / (DESKTOP_W + 2)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDesktop]);

  if (isDesktop) {
    return (
      <div ref={stageRef} className="flex w-full max-w-[1060px] flex-col items-center gap-3">
        <div className="w-full" style={{ height: (DESKTOP_H + 44) * scale + 2 }}>
          <div
            className="origin-top-left overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
            style={{ width: DESKTOP_W + 2, transform: `scale(${scale})` }}
          >
            <div className="flex h-11 items-center gap-3 border-b border-white/10 bg-white/[0.07] px-4 backdrop-blur-2xl">
              <span className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
              </span>
              <span className="mx-auto flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/25 px-3 py-1 font-v-mono text-[10px] text-v-mut">
                <Lock className="h-2.5 w-2.5 text-v-faint" />
                {src.replace(/^https?:\/\//, "")}
              </span>
              <span className="w-12" aria-hidden />
            </div>
            {allDown ? (
              <div style={{ width: DESKTOP_W, height: DESKTOP_H }}>
                <OriginDown onRetry={onRetry} />
              </div>
            ) : resolving ? (
              <div
                className="bg-[#0B0B0A]"
                style={{ width: DESKTOP_W, height: DESKTOP_H }}
              />
            ) : (
              <iframe
                key={`${origin}-${reloadKey}`}
                src={src}
                title="Live menu preview"
                className="block border-0 bg-black"
                style={{ width: DESKTOP_W, height: DESKTOP_H }}
              />
            )}
          </div>
        </div>
        {origin && <SourceBadge origin={origin} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-[44px] border border-white/10 bg-black/60 p-2 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="relative overflow-hidden rounded-[36px] bg-black" style={{ width: 375, height: 720 }}>
          {allDown ? (
            <OriginDown onRetry={onRetry} />
          ) : resolving ? null : (
            <iframe
              key={`${origin}-${reloadKey}`}
              src={src}
              title="Live menu preview"
              className="block h-full w-full border-0"
            />
          )}
        </div>
      </div>
      {origin && <SourceBadge origin={origin} />}
    </div>
  );
}
