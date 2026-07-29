"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, MonitorOff, RefreshCw } from "lucide-react";
import type { PreviewViewport } from "./MenuPreview";

// ─────────────────────────────────────────────────────────────────────────────
// LiveFrame — the REAL menu page in an iframe, framed exactly like the draft
// preview. What you see here is byte-for-byte what a diner sees: the actual
// /{locale}/menu/{slug} route of the consumer app.
//
// Origin: NEXT_PUBLIC_MENU_ORIGIN overrides; otherwise localhost:3001 in dev
// (the sibling consumer app on the same dev Convex) and shemoqmedi.space in
// production.
// ─────────────────────────────────────────────────────────────────────────────

export const MENU_ORIGIN =
  process.env.NEXT_PUBLIC_MENU_ORIGIN ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://shemoqmedi.space");

export function menuUrl(slug: string, locale: string): string {
  return `${MENU_ORIGIN}/${locale}/menu/${slug}`;
}

const DESKTOP_W = 1024;
const DESKTOP_H = 640;

/** Friendly stand-in when the menu origin is unreachable (e.g. the consumer
 *  dev server isn't running) — beats an iframe error page. */
function OriginDown({ onRetry }: { onRetry: () => void }) {
  const isLocal = MENU_ORIGIN.includes("localhost");
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0B0B0A] px-8 text-center">
      <MonitorOff className="h-7 w-7 text-v-faint" />
      <p className="text-sm font-medium text-v-ink">
        Live menu isn&apos;t reachable
      </p>
      <p className="text-xs leading-relaxed text-v-mut">
        {isLocal
          ? "The consumer app isn't running. Start the \"site\" dev server (port 3001), or switch the preview to Draft."
          : "The live menu page didn't respond. Check your connection, or switch the preview to Draft."}
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
  const src = menuUrl(slug, locale);

  // Probe the origin so a dead dev server shows guidance, not a browser
  // error page. no-cors resolves when the server answers at all.
  const [originUp, setOriginUp] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(MENU_ORIGIN, { mode: "no-cors", cache: "no-store" })
      .then(() => {
        if (!cancelled) setOriginUp(true);
      })
      .catch(() => {
        if (!cancelled) setOriginUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

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
            {originUp === false ? (
              <div style={{ width: DESKTOP_W, height: DESKTOP_H }}>
                <OriginDown onRetry={onRetry} />
              </div>
            ) : (
              <iframe
                key={reloadKey}
                src={src}
                title="Live menu preview"
                className="block border-0 bg-black"
                style={{ width: DESKTOP_W, height: DESKTOP_H }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-[44px] border border-white/10 bg-black/60 p-2 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="relative overflow-hidden rounded-[36px] bg-black" style={{ width: 375, height: 720 }}>
          {originUp === false ? (
            <OriginDown onRetry={onRetry} />
          ) : (
            <iframe
              key={reloadKey}
              src={src}
              title="Live menu preview"
              className="block h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
