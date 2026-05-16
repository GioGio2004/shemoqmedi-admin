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
    <div className="flex items-center gap-3 mb-6">
      <div className="h-8 w-8 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div>
        <h2 className="text-white font-medium text-sm">{title}</h2>
        {badge && (
          <Badge variant="outline" className="text-[10px] text-zinc-500 border-white/10 bg-transparent mt-0.5 font-medium">
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
        "flex items-center justify-between p-4 rounded-xl border transition-all duration-200 cursor-pointer select-none",
        enabled
          ? "border-white/25 bg-white/[0.06]"
          : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]"
      )}
      onClick={() => onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
          enabled ? "bg-white/15" : "bg-white/5"
        )}>
          <Icon className={cn("h-4 w-4 transition-colors", enabled ? "text-white" : "text-zinc-500")} />
        </div>
        <div>
          <p className={cn("text-sm font-medium transition-colors", enabled ? "text-white" : "text-zinc-400")}>
            {feature.label}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">{feature.description}</p>
        </div>
      </div>
      <div className="shrink-0 ml-4">
        {enabled
          ? <ToggleRight className="h-5 w-5 text-white" />
          : <ToggleLeft className="h-5 w-5 text-zinc-600" />}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map((i) => (
        <div key={i} className="bg-[#09090b] border border-white/10 rounded-2xl p-6 animate-pulse">
          <div className="h-4 w-32 bg-white/10 rounded mb-6" />
          <div className="space-y-3">
            {[1, 2, 3].map((j) => (
              <div key={j} className="h-14 bg-white/5 rounded-xl" />
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
      <div className="space-y-6 text-zinc-50 font-sans">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
          <h1 className="text-3xl font-medium tracking-tight text-white">Settings</h1>
          <p className="text-sm text-zinc-400 mt-1">Loading workspace configuration…</p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Settings className="h-8 w-8 text-zinc-600" />
        <p className="font-medium text-white">No workspace selected</p>
        <p className="text-sm text-zinc-400 max-w-xs">Select a workspace from the sidebar to configure its settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-zinc-50 font-sans max-w-2xl">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        <div className="flex items-center gap-2 mb-1">
          <Settings className="h-4 w-4 text-white" />
          <h1 className="text-3xl font-medium tracking-tight text-white">Settings</h1>
        </div>
        <p className="text-sm text-zinc-400">
          Configure the Liquid UI and feature entitlements for{" "}
          <span className="text-white font-medium">{organization?.name}</span>.
        </p>
      </div>

      {/* ── Section A: Theme Settings ───────────────────────────────────────── */}
      <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both bg-[#09090b] border-white/10 shadow-none rounded-2xl">
        <CardHeader className="px-6 pt-6 pb-0">
          <SectionHeader icon={Palette} title="Liquid UI Engine" badge="Customer-facing PWA" />
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-5">

          {/* Primary Color */}
          <div className="space-y-2">
            <Label className="text-zinc-300 text-xs font-medium uppercase tracking-widest">Primary Color</Label>
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 rounded-lg border border-white/20 overflow-hidden shrink-0">
                <input
                  type="color"
                  value={theme.primaryColor}
                  onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                  className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                  id="color-picker"
                />
                <div
                  className="w-full h-full rounded-lg"
                  style={{ backgroundColor: theme.primaryColor }}
                />
              </div>
              <Input
                value={theme.primaryColor}
                onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                placeholder="#ffffff"
                className="flex-1 bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30 font-mono text-sm"
              />
            </div>
          </div>

          {/* Font Family */}
          <div className="space-y-2">
            <Label className="text-zinc-300 text-xs font-medium uppercase tracking-widest">Font Family</Label>
            <div className="grid grid-cols-2 gap-2">
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme((t) => ({ ...t, fontFamily: opt.value }))}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all",
                    theme.fontFamily === opt.value
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <span className="text-lg font-medium w-7" style={{ fontFamily: opt.value }}>{opt.preview}</span>
                  <span className="text-xs font-medium">{opt.label}</span>
                  {theme.fontFamily === opt.value && <Check className="h-3 w-3 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Button Radius */}
          <div className="space-y-2">
            <Label className="text-zinc-300 text-xs font-medium uppercase tracking-widest">Button Radius</Label>
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
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview pill */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 flex items-center gap-4">
            <p className="text-xs text-zinc-500 font-medium shrink-0">Preview</p>
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
              className="bg-white text-black hover:bg-zinc-200 font-medium rounded-lg shadow-none min-w-[120px]"
            >
              {themeSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : themeSaved ? (
                <Check className="h-4 w-4 mr-2 text-black" />
              ) : null}
              {themeSaved ? "Saved!" : "Save Theme"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Section B: Feature Entitlements ────────────────────────────────── */}
      <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both bg-[#09090b] border-white/10 shadow-none rounded-2xl">
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
              className="bg-white text-black hover:bg-zinc-200 font-medium rounded-lg shadow-none min-w-[140px]"
            >
              {featuresSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : featuresSaved ? (
                <Check className="h-4 w-4 mr-2 text-black" />
              ) : null}
              {featuresSaved ? "Updated!" : "Update Features"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
