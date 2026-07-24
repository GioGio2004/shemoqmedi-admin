"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Settings,
  Palette,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Check,
  Wifi,
  UtensilsCrossed,
  Globe,
  Bot,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type ThemeSettings = {
  primaryColor: string;
  fontFamily: string;
  buttonRadius: string;
};

type Features = {
  hasNfcHardware: boolean;
  hasDigitalMenu: boolean;
  hasCustomDomain: boolean;
  hasAiManager: boolean;
  hasLiveOrdering: boolean;
};

const DEFAULT_THEME: ThemeSettings = {
  primaryColor: "#ffffff",
  fontFamily: "Outfit",
  buttonRadius: "0.5rem",
};

const DEFAULT_FEATURES: Features = {
  hasNfcHardware: false,
  hasDigitalMenu: false,
  hasCustomDomain: false,
  hasAiManager: false,
  hasLiveOrdering: false,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  { value: "Outfit", label: "Outfit", preview: "Aa" },
  { value: "Inter", label: "Inter", preview: "Aa" },
  { value: "JetBrains Mono", label: "JetBrains Mono", preview: "Aa" },
  { value: "Playfair Display", label: "Playfair Display", preview: "Aa" },
];

const RADIUS_OPTIONS = [
  { value: "0px", label: "Sharp" },
  { value: "0.5rem", label: "Rounded" },
  { value: "9999px", label: "Pill" },
];

const FEATURE_META: { key: keyof Features; label: string; description: string; icon: React.ElementType }[] = [
  { key: "hasNfcHardware", label: "NFC Hardware", description: "Physical Voloo NFC terminals deployed at tables", icon: Wifi },
  { key: "hasDigitalMenu", label: "Digital Menu", description: "Customer-facing PWA menu accessible via QR or NFC", icon: UtensilsCrossed },
  { key: "hasCustomDomain", label: "Custom Domain", description: "Serve the menu on a branded domain (e.g. menu.cafe.ge)", icon: Globe },
  { key: "hasAiManager", label: "AI Manager", description: "GPT-4o powered menu translation and upsell suggestions", icon: Bot },
  { key: "hasLiveOrdering", label: "Live Ordering", description: "Real-time order pipeline with kitchen display integration", icon: ShoppingBag },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, badge }: { icon: React.ElementType; title: string; badge?: string }) {
  return (
    <div className="mb-6 flex items-center gap-3 border-b border-v-line pb-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-v border border-v-line bg-white/[0.03]">
        <Icon className="h-4 w-4 text-v-mut" />
      </div>
      <div>
        <h2 className="text-sm font-medium text-v-ink">{title}</h2>
        {badge && (
          <Badge variant="outline" className="v-t-micro mt-0.5 rounded-v border-v-line bg-transparent text-v-faint">
            {badge}
          </Badge>
        )}
      </div>
    </div>
  );
}

function FeatureToggle({
  feature,
  enabled,
  onChange,
}: {
  feature: (typeof FEATURE_META)[number];
  enabled: boolean;
  onChange: (val: boolean) => void;
}) {
  const Icon = feature.icon;
  return (
    <div
      className={cn(
        "flex items-center justify-between p-4 rounded-v border transition-all duration-200 cursor-pointer select-none",
        enabled
          ? "border-v-accent/40 bg-v-accent/[0.05]"
          : "border-v-line bg-white/[0.02] hover:bg-white/[0.04]"
      )}
      onClick={() => onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-v border transition-colors",
          enabled ? "border-v-accent/40" : "border-v-line"
        )}>
          <Icon className={cn("h-4 w-4 transition-colors", enabled ? "text-v-accent" : "text-v-faint")} />
        </div>
        <div>
          <p className={cn("text-sm font-medium transition-colors", enabled ? "text-v-ink" : "text-v-mut")}>
            {feature.label}
          </p>
          <p className="mt-0.5 text-xs text-v-faint">{feature.description}</p>
        </div>
      </div>
      <div className="shrink-0 ml-4">
        {enabled
          ? <ToggleRight className="h-5 w-5 text-v-accent" />
          : <ToggleLeft className="h-5 w-5 text-v-faint" />}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-v border border-v-line bg-v-bg-raise p-6">
          <div className="mb-6 h-4 w-32 rounded-v bg-white/[0.06]" />
          <div className="space-y-3">
            {[1, 2, 3].map((j) => (
              <div key={j} className="h-14 rounded-v bg-white/[0.03]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { organization, isLoaded } = useOrganization();
  const orgId = organization?.id;

  const settings = useQuery(
    api.organizations.getOrgSettings,
    orgId ? { orgId } : "skip"
  );

  const updateTheme = useMutation(api.organizations.updateThemeSettings);
  const updateFeaturesMutation = useMutation(api.organizations.updateFeatures);

  // ── Local form state ──────────────────────────────────────────────────────
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES);
  const [themeSaving, setThemeSaving] = useState(false);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [themeSaved, setThemeSaved] = useState(false);
  const [featuresSaved, setFeaturesSaved] = useState(false);

  // Populate form from Convex once data arrives
  useEffect(() => {
    if (!settings) return;
    if (settings.themeSettings) setTheme(settings.themeSettings);
    if (settings.features) setFeatures(settings.features);
  }, [settings]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSaveTheme() {
    if (!orgId) return;
    setThemeSaving(true);
    try {
      await updateTheme({ orgId, themeSettings: theme });
      setThemeSaved(true);
      setTimeout(() => setThemeSaved(false), 2500);
    } finally {
      setThemeSaving(false);
    }
  }

  async function handleSaveFeatures() {
    if (!orgId) return;
    setFeaturesSaving(true);
    try {
      await updateFeaturesMutation({ orgId, features });
      setFeaturesSaved(true);
      setTimeout(() => setFeaturesSaved(false), 2500);
    } finally {
      setFeaturesSaving(false);
    }
  }

  function toggleFeature(key: keyof Features, val: boolean) {
    setFeatures((f) => ({ ...f, [key]: val }));
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!isLoaded || settings === undefined) {
    return (
      <div className="space-y-6 font-sans text-v-ink">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
          <h1 className="font-v-display text-3xl font-medium tracking-tight text-v-ink">Settings</h1>
          <p className="mt-1 text-sm text-v-mut">Loading workspace configuration…</p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Settings className="h-8 w-8 text-v-faint" />
        <p className="font-medium text-v-ink">No workspace selected</p>
        <p className="max-w-xs text-sm text-v-mut">Select a workspace from the sidebar to configure its settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 font-sans text-v-ink">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        <div className="flex items-center gap-2 mb-1">
          <Settings className="h-4 w-4 text-v-mut" />
          <h1 className="font-v-display text-2xl font-medium tracking-tight text-v-ink sm:text-3xl">Settings</h1>
        </div>
        <p className="text-sm text-v-mut">
          Configure the Liquid UI and feature entitlements for{" "}
          <span className="font-medium text-v-ink">{organization?.name}</span>.
        </p>
      </div>

      {/* ── Section A: Theme Settings ───────────────────────────────────────── */}
      <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both rounded-v border-v-line bg-v-bg-raise shadow-none">
        <CardHeader className="px-6 pt-6 pb-0">
          <SectionHeader icon={Palette} title="Liquid UI Engine" badge="Customer-facing PWA" />
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-5">

          {/* Primary Color */}
          <div className="space-y-2">
            <Label className="v-t-micro text-v-faint">Primary Color</Label>
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-v border border-v-line">
                <input
                  type="color"
                  value={theme.primaryColor}
                  onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                  className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                  id="color-picker"
                />
                <div
                  className="h-full w-full rounded-v"
                  style={{ backgroundColor: theme.primaryColor }}
                />
              </div>
              <Input
                value={theme.primaryColor}
                onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                placeholder="#ffffff"
                className="flex-1 rounded-v border-v-line bg-white/[0.03] font-v-mono text-sm text-v-ink placeholder:text-v-faint focus-visible:border-v-accent focus-visible:ring-0"
              />
            </div>
          </div>

          {/* Font Family */}
          <div className="space-y-2">
            <Label className="v-t-micro text-v-faint">Font Family</Label>
            <div className="grid grid-cols-2 gap-2">
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme((t) => ({ ...t, fontFamily: opt.value }))}
                  className={cn(
                    "flex items-center gap-3 rounded-v border px-4 py-3 text-left transition-all",
                    theme.fontFamily === opt.value
                      ? "border-v-accent/50 bg-v-accent/[0.06] text-v-ink"
                      : "border-v-line bg-white/[0.02] text-v-mut hover:bg-white/[0.04] hover:text-v-ink"
                  )}
                >
                  <span className="text-lg font-medium w-7" style={{ fontFamily: opt.value }}>{opt.preview}</span>
                  <span className="text-xs font-medium">{opt.label}</span>
                  {theme.fontFamily === opt.value && <Check className="ml-auto h-3 w-3 text-v-accent" />}
                </button>
              ))}
            </div>
          </div>

          {/* Button Radius */}
          <div className="space-y-2">
            <Label className="v-t-micro text-v-faint">Button Radius</Label>
            <div className="flex gap-2">
              {RADIUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme((t) => ({ ...t, buttonRadius: opt.value }))}
                  className={cn(
                    "flex-1 py-2.5 text-xs font-medium border transition-all",
                    opt.value === "0px" ? "rounded-none" : opt.value === "9999px" ? "rounded-full" : "rounded-lg",
                    theme.buttonRadius === opt.value
                      ? "border-v-accent/50 bg-v-accent/[0.06] text-v-ink"
                      : "border-v-line bg-white/[0.02] text-v-mut hover:bg-white/[0.04] hover:text-v-ink"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview pill */}
          <div className="flex items-center gap-4 rounded-v border border-v-line bg-white/[0.02] p-4">
            <p className="v-t-micro shrink-0 text-v-faint">Preview</p>
            <button
              className="px-4 py-2 text-sm font-medium text-black transition-all"
              style={{
                backgroundColor: theme.primaryColor,
                borderRadius: theme.buttonRadius,
                fontFamily: theme.fontFamily,
              }}
            >
              Order Now
            </button>
          </div>

          {/* Save */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveTheme}
              disabled={themeSaving}
              className="v-press min-w-[120px] rounded-v bg-v-accent font-semibold text-v-accent-ink shadow-none transition-[filter] hover:bg-v-accent hover:brightness-95"
            >
              {themeSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : themeSaved ? (
                <Check className="mr-2 h-4 w-4 text-v-accent-ink" />
              ) : null}
              {themeSaved ? "Saved!" : "Save Theme"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Section B: Feature Entitlements ────────────────────────────────── */}
      <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both rounded-v border-v-line bg-v-bg-raise shadow-none">
        <CardHeader className="px-6 pt-6 pb-0">
          <SectionHeader
            icon={Settings}
            title="Modular Features"
            badge="Drives billing calculation"
          />
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-2">
          {FEATURE_META.map((feat) => (
            <FeatureToggle
              key={feat.key}
              feature={feat}
              enabled={features[feat.key]}
              onChange={(val) => toggleFeature(feat.key, val)}
            />
          ))}

          {/* Save */}
          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSaveFeatures}
              disabled={featuresSaving}
              className="v-press min-w-[140px] rounded-v bg-v-accent font-semibold text-v-accent-ink shadow-none transition-[filter] hover:bg-v-accent hover:brightness-95"
            >
              {featuresSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : featuresSaved ? (
                <Check className="mr-2 h-4 w-4 text-v-accent-ink" />
              ) : null}
              {featuresSaved ? "Updated!" : "Update Features"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
