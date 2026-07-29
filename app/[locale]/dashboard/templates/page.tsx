"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useOrganization } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast, Toaster } from "sonner";
import { CheckCircle2, Layers, Loader2, Wand2 } from "lucide-react";
import {
  TemplatePanel,
  type LegacyTheme,
  type RuledContent,
} from "../storefront/_components/TemplatePanel";

// ─────────────────────────────────────────────────────────────────────────────
// Templates — extracted from the storefront studio. Ready-made menu templates
// (Signature / Classic / Spatial) stay available here for venues that want a
// pre-built look instead of designing their own; the studio is the main path.
// ─────────────────────────────────────────────────────────────────────────────

interface TemplatesState {
  theme: LegacyTheme;
  ruled: RuledContent;
}

export default function TemplatesPage() {
  const { organization, isLoaded } = useOrganization();
  const { isAuthenticated } = useConvexAuth();
  const orgId = organization?.id;
  const config = useQuery(
    api.organizations.getStorefrontConfig,
    orgId && isAuthenticated ? { orgId } : "skip",
  );
  const saveConfig = useMutation(api.organizations.updateStorefrontConfig);

  const [edits, setEdits] = useState<TemplatesState | null>(null);
  const initial = useMemo<TemplatesState | null>(() => {
    if (!config) return null;
    const r = config.ruledMenuConfig;
    return {
      theme: config.themeSettings ?? {
        primaryColor: "#ffffff",
        backgroundColor: "#09090b",
        textColor: "#ffffff",
        fontFamily: "Inter",
        buttonRadius: "0.5rem",
        menuType: "basic",
        categoryLayout: "pills",
      },
      ruled: {
        tickerText: r?.tickerText ?? {},
        storyText: r?.storyText ?? {},
        storyImageUrl: r?.storyImageUrl ?? "",
        galleryImageUrls: r?.galleryImageUrls ?? [],
        accentColor: r?.accentColor ?? "",
        menuStyle: r?.menuStyle ?? "gallery",
        showTicker: r?.showTicker ?? true,
        showTunnel: r?.showTunnel ?? true,
        showFeatured: r?.showFeatured ?? true,
        showStory: r?.showStory ?? true,
        showGallery: r?.showGallery ?? true,
      },
    };
  }, [config]);
  const state = edits ?? initial;

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state || !orgId) return;
    const json = JSON.stringify(state);
    if (edits === null) {
      savedRef.current = json;
      return;
    }
    if (json === savedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        setSaveState("saving");
        const clean = (r: Record<string, string>) => {
          const out = Object.fromEntries(
            Object.entries(r).filter(([, v]) => v && v.trim()),
          );
          return Object.keys(out).length ? out : undefined;
        };
        await saveConfig({
          orgId,
          themeSettings: state.theme,
          ruledMenuConfig: {
            tickerText: clean(state.ruled.tickerText),
            storyText: clean(state.ruled.storyText),
            storyImageUrl: state.ruled.storyImageUrl || undefined,
            galleryImageUrls: state.ruled.galleryImageUrls.length
              ? state.ruled.galleryImageUrls
              : undefined,
            accentColor: state.ruled.accentColor || undefined,
            menuStyle: state.ruled.menuStyle,
            showTicker: state.ruled.showTicker,
            showTunnel: state.ruled.showTunnel,
            showFeatured: state.ruled.showFeatured,
            showStory: state.ruled.showStory,
            showGallery: state.ruled.showGallery,
          },
        });
        savedRef.current = json;
        setSaveState("saved");
      } catch {
        setSaveState("idle");
        toast.error("Template settings failed to save.");
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [state, edits, orgId, saveConfig]);

  if (!isLoaded || (orgId && config === undefined)) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-v-faint" />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Layers className="h-8 w-8 text-v-faint" />
        <p className="font-medium text-v-ink">No workspace selected</p>
        <p className="max-w-xs text-sm text-v-mut">
          Select a workspace from the sidebar to manage its menu template.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl text-v-ink">
      <Toaster position="bottom-right" theme="dark" />

      <div className="mb-4 flex items-start justify-between gap-4 px-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Layers className="h-4 w-4 text-v-mut" />
            <h1 className="font-v-display text-2xl font-medium tracking-tight">
              Menu templates
            </h1>
          </div>
          <p className="max-w-md text-sm text-v-mut">
            Ready-made looks for your public menu. Prefer full creative
            control? Design your own in the{" "}
            <Link
              href="/dashboard/storefront"
              className="inline-flex items-center gap-1 text-v-accent hover:brightness-110"
            >
              <Wand2 className="h-3 w-3" />
              storefront studio
            </Link>
            . Changes here save live automatically.
          </p>
        </div>
        <span className="v-t-micro mt-1 flex shrink-0 items-center gap-1.5 text-v-faint">
          {saveState === "saving" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving
            </>
          ) : saveState === "saved" ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Saved
            </>
          ) : null}
        </span>
      </div>

      {state && (
        <TemplatePanel
          theme={state.theme}
          onTheme={(t) =>
            setEdits((prev) => ({ ...(prev ?? initial!), theme: t }))
          }
          ruled={state.ruled}
          onRuled={(r) =>
            setEdits((prev) => ({ ...(prev ?? initial!), ruled: r }))
          }
          cafeName={organization?.name ?? "cafe"}
        />
      )}
    </div>
  );
}
