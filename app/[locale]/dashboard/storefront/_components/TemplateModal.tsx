"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  Pencil,
  Sparkles,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE PICKER — the one place a venue chooses what renders publicly.
//
// It replaces the old /dashboard/templates page. Two surfaces both writing
// themeSettings is what silently broke venues before: publishing a custom
// design sets menuType "studio", picking a template sets it back, and the
// picker had no way to return — so a published design could sit live-but-
// unreachable forever. This modal always shows the TRUE live state, including
// that shadowed case, and switching writes only menuType.
//
// Opens automatically on a venue's first visit, and any time from the header.
// ─────────────────────────────────────────────────────────────────────────────

export type MenuType = "basic" | "dragable" | "ruled" | "studio";

export const TEMPLATE_FLOW = "template-picker";

interface TemplateDef {
  key: MenuType;
  name: string;
  tagline: string;
  blurb: string;
}

const TEMPLATES: TemplateDef[] = [
  {
    key: "ruled",
    name: "Signature",
    tagline: "Cinematic editorial",
    blurb:
      "The award-grade look — motion, story section and a full-bleed gallery.",
  },
  {
    key: "basic",
    name: "Classic",
    tagline: "Vertical scroll",
    blurb: "Clean and fast. Categories up top, dishes in a simple list.",
  },
  {
    key: "dragable",
    name: "Spatial",
    tagline: "Drag to explore",
    blurb: "A playful canvas guests push around to discover dishes.",
  },
  {
    key: "studio",
    name: "Custom design",
    tagline: "Built by you",
    blurb:
      "Your own layout, colours and motion — designed here in the studio.",
  },
];

/** Tiny abstract previews (no screenshots to keep stale). */
function Mockup({ kind }: { kind: MenuType }) {
  if (kind === "ruled") {
    return (
      <div className="flex w-20 flex-col gap-1 border-y border-white/25 px-1 py-2">
        <div className="h-2 w-12 rounded-[1px] bg-white/60" />
        <div className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 flex-1 rounded-[1px] bg-white/25" />
          ))}
        </div>
        <div className="h-1 w-14 rounded-full bg-white/30" />
      </div>
    );
  }
  if (kind === "basic") {
    return (
      <div className="flex w-20 flex-col gap-1.5 py-2">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-2 w-5 rounded-full bg-white/40" />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3.5 rounded-[2px] bg-white/20" />
        ))}
      </div>
    );
  }
  if (kind === "dragable") {
    return (
      <div className="relative h-16 w-20 overflow-hidden rounded-[2px] bg-white/10">
        {[
          [2, 3],
          [11, 1],
          [6, 8],
          [13, 7],
        ].map(([x, y], i) => (
          <div
            key={i}
            className="absolute h-4 w-4 rounded-[1px] bg-white/40"
            style={{ left: x * 4, top: y * 4 }}
          />
        ))}
      </div>
    );
  }
  // studio — a "your own" canvas
  return (
    <div className="flex h-16 w-20 flex-col items-center justify-center gap-1.5 rounded-[2px] border border-dashed border-v-accent/40 bg-v-accent/[0.06]">
      <Wand2 className="h-5 w-5 text-v-accent" />
      <div className="h-1 w-10 rounded-full bg-v-accent/40" />
    </div>
  );
}

export function TemplateModal({
  orgId,
  open,
  onClose,
  onStartEditing,
}: {
  orgId: string;
  open: boolean;
  /** `reason` lets the caller record intent (kept / switched / editing). */
  onClose: (reason: "kept" | "switched" | "editing" | "dismissed") => void;
  /** Jump the workspace to the Design section. */
  onStartEditing: () => void;
}) {
  const state = useQuery(
    api.organizations.getMenuTemplateState,
    open ? { orgId } : "skip",
  );
  const setTemplate = useMutation(api.organizations.setMenuTemplate);
  const [busy, setBusy] = useState<MenuType | null>(null);

  // Esc closes — a modal that traps you is worse than no modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose("dismissed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = state?.menuType ?? "basic";
  const hasDesign = state?.hasPublishedDesign ?? false;
  const shadowed = state?.customDesignShadowed ?? false;
  const activeDef = TEMPLATES.find((t) => t.key === active);

  const pick = async (t: MenuType) => {
    if (t === active) return;
    // Custom design with nothing published yet → send them to the editor
    // rather than throwing a validation error at them.
    if (t === "studio" && !hasDesign) {
      onStartEditing();
      onClose("editing");
      return;
    }
    try {
      setBusy(t);
      await setTemplate({ orgId, menuType: t });
      toast.success(
        t === "studio"
          ? "Your custom design is live."
          : `${TEMPLATES.find((x) => x.key === t)?.name} is live.`,
      );
      onClose("switched");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.includes("Publish")
          ? "Publish your design first, then switch to it."
          : "Could not switch template. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-modal-title"
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => onClose("dismissed")}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d]/95 shadow-2xl backdrop-blur-xl">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2
              id="tpl-modal-title"
              className="font-v-display text-lg font-medium tracking-tight text-v-ink"
            >
              {hasDesign && active === "studio"
                ? "Your custom design is live"
                : activeDef
                  ? `You're using ${activeDef.name}`
                  : "Choose your menu template"}
            </h2>
            <p className="mt-0.5 max-w-lg text-[12px] leading-relaxed text-v-mut">
              This is what guests see when they open your menu. Switch any
              time — your content and dishes stay exactly as they are.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose("dismissed")}
            className="rounded-lg p-1.5 text-v-faint transition-colors hover:bg-white/10 hover:text-v-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Shadowed-design warning: the exact bug that hid venue work ── */}
        {shadowed && (
          <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="text-[12px] leading-relaxed text-v-mut">
              <strong className="font-semibold text-v-ink">
                You have a published custom design that isn&apos;t showing.
              </strong>{" "}
              A ready-made template is rendering instead. Pick{" "}
              <strong className="font-semibold text-v-ink">Custom design</strong>{" "}
              below to put your own work back on the menu.
            </div>
          </div>
        )}

        {/* ── Template grid ── */}
        <div className="grid grid-cols-1 gap-2.5 overflow-y-auto p-5 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const isActive = t.key === active;
            const isCustom = t.key === "studio";
            return (
              <button
                key={t.key}
                type="button"
                disabled={busy !== null}
                onClick={() => pick(t.key)}
                className={cn(
                  "group relative flex gap-3 rounded-xl border p-3 text-left transition-all disabled:opacity-60",
                  isActive
                    ? "border-v-accent/60 bg-v-accent/[0.10] ring-1 ring-v-accent/30"
                    : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]",
                )}
              >
                <div className="pointer-events-none flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-black/40 p-1.5">
                  <Mockup kind={t.key} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p
                      className={cn(
                        "text-[13px] font-medium leading-tight",
                        isActive ? "text-v-accent" : "text-v-ink",
                      )}
                    >
                      {t.name}
                    </p>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-v-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-v-accent">
                        <Check className="h-2.5 w-2.5" /> Live
                      </span>
                    )}
                    {isCustom && hasDesign && !isActive && (
                      <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-v-mut">
                        Ready
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-v-faint">
                    {t.tagline}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-v-mut">
                    {isCustom && !hasDesign
                      ? "Design your own from scratch — opens the studio."
                      : t.blurb}
                  </p>
                </div>
                {busy === t.key && (
                  <Loader2 className="absolute right-3 top-3 h-3.5 w-3.5 animate-spin text-v-accent" />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Footer actions ── */}
        <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-v-faint">
            <Sparkles className="mr-1 inline h-3 w-3 text-v-accent" />
            Every template uses your own dishes, photos and text.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onClose("kept")}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[12px] font-medium text-v-ink transition-colors hover:bg-white/[0.09]"
            >
              Keep {activeDef?.name ?? "current"}
            </button>
            <button
              type="button"
              onClick={() => {
                onStartEditing();
                onClose("editing");
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-v-accent px-3.5 py-2 text-[12px] font-semibold text-black transition-[filter] hover:brightness-110"
            >
              <Pencil className="h-3.5 w-3.5" />
              Start editing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
