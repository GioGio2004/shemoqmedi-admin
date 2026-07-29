"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  Eye,
  Layers,
  MessageSquare,
  Palette,
  PartyPopper,
  Rocket,
  Store,
  Type,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// StudioTutorial — first-visit guided tour of the workspace. Every step
// advance, skip and completion is written to the Convex `onboarding` table
// (flow "storefront-studio"), so venue onboarding is measurable later.
// The workspace itself changes behind the translucent overlay as steps
// advance — the tour shows, not just tells.
// ─────────────────────────────────────────────────────────────────────────────

export const STUDIO_FLOW = "storefront-studio";

export interface TutorialApply {
  section?: "design" | "content" | "venue" | "chat";
  mobileView?: "panels" | "preview";
  previewMode?: "live" | "draft";
}

const STEPS: Array<{
  key: string;
  icon: React.ElementType;
  title: string;
  body: string;
  apply: TutorialApply;
}> = [
  {
    key: "welcome",
    icon: PartyPopper,
    title: "Welcome to your storefront studio",
    body: "This is the one place to shape everything your diners see — the menu design, your venue's content, and the AI assistant. The quick tour takes about a minute.",
    apply: { section: "design", mobileView: "panels" },
  },
  {
    key: "design",
    icon: Palette,
    title: "Design",
    body: "Colors, fonts, card styles, hero layouts and motion. Design changes save as a private draft — nothing reaches diners until you press Publish.",
    apply: { section: "design", mobileView: "panels" },
  },
  {
    key: "content",
    icon: Type,
    title: "Content",
    body: "Your headline, photos and address. Use the EN · KA · RU switch to write each language in the same field. Content saves live a moment after you stop typing.",
    apply: { section: "content", mobileView: "panels" },
  },
  {
    key: "venue",
    icon: Store,
    title: "Venue",
    body: "Opening hours, contact links, and announcements you can toggle live when something changes — renovation weekend, seasonal hours, a special.",
    apply: { section: "venue", mobileView: "panels" },
  },
  {
    key: "chat",
    icon: MessageSquare,
    title: "AI assistant",
    body: "VolooAI answers menu questions on your page in Georgian, English and Russian. Set its name, greeting and colors here — the preview shows the widget exactly as diners get it.",
    apply: { section: "chat", mobileView: "panels" },
  },
  {
    key: "preview",
    icon: Eye,
    title: "The preview is the real thing",
    body: "Live shows your actual public menu page — identical to what a diner sees after scanning. Draft shows the new design system you're working on. Flip between phone and desktop any time.",
    apply: { mobileView: "preview", previewMode: "live" },
  },
  {
    key: "publish",
    icon: Rocket,
    title: "Publish, and one more thing",
    body: "Publish pushes your design draft live. Prefer a ready-made look instead of designing? Classic menu templates now live on their own page — find the Templates link at the bottom of the Design panel.",
    apply: { section: "design", mobileView: "panels" },
  },
];

export function StudioTutorial({
  orgId,
  onApply,
  onClose,
}: {
  orgId: string;
  onApply: (a: TutorialApply) => void;
  onClose: () => void;
}) {
  const recordStep = useMutation(api.onboarding.recordStep);
  const finish = useMutation(api.onboarding.finish);
  const [index, setIndex] = useState(0);
  const startedRef = useRef(false);

  // Stamp the tour as started the moment it first shows.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    recordStep({ flow: STUDIO_FLOW, orgId, step: STEPS[0].key }).catch(() => {});
  }, [orgId, recordStep]);

  const step = STEPS[index];
  const Icon = step.icon;
  const isLast = index === STEPS.length - 1;

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(next, STEPS.length - 1));
    setIndex(clamped);
    onApply(STEPS[clamped].apply);
    recordStep({ flow: STUDIO_FLOW, orgId, step: STEPS[clamped].key }).catch(
      () => {},
    );
  };

  const handleSkip = () => {
    finish({ flow: STUDIO_FLOW, orgId, outcome: "skipped" }).catch(() => {});
    onClose();
  };

  const handleDone = () => {
    finish({ flow: STUDIO_FLOW, orgId, outcome: "completed" }).catch(() => {});
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 backdrop-blur-[3px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Studio tutorial"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/[0.12] bg-[#111110]/90 p-6 shadow-[0_32px_90px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
        {/* Step dots */}
        <div className="mb-5 flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                i === index
                  ? "w-6 bg-v-accent"
                  : i < index
                    ? "w-2.5 bg-v-accent/40"
                    : "w-2.5 bg-white/[0.12]",
              )}
            />
          ))}
          <span className="ml-auto font-v-mono text-[10px] tabular-nums text-v-faint">
            {index + 1}/{STEPS.length}
          </span>
        </div>

        <div className="mb-1.5 flex h-11 w-11 items-center justify-center rounded-2xl border border-v-accent/25 bg-v-accent/[0.1]">
          <Icon className="h-5 w-5 text-v-accent" />
        </div>
        <h2 className="mt-3 font-v-display text-lg font-medium tracking-tight text-v-ink">
          {step.title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-v-mut">{step.body}</p>

        <div className="mt-6 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSkip}
            className="v-t-micro rounded-xl px-3 py-2.5 text-v-faint transition-colors hover:text-v-ink"
          >
            Skip tour
          </button>
          <div className="flex-1" />
          {index > 0 && (
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-medium text-v-mut transition-colors hover:text-v-ink"
            >
              Back
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              onClick={handleDone}
              className="flex items-center gap-2 rounded-xl bg-v-accent px-5 py-2.5 text-xs font-semibold text-v-accent-ink shadow-[0_4px_20px_rgba(216,255,58,0.25)] transition-all hover:brightness-95"
            >
              <Layers className="h-3.5 w-3.5" />
              Start designing
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="rounded-xl bg-v-accent px-5 py-2.5 text-xs font-semibold text-v-accent-ink shadow-[0_4px_20px_rgba(216,255,58,0.25)] transition-all hover:brightness-95"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
