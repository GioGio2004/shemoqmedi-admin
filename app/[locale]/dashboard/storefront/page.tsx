"use client";

import { useState, useEffect } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Store,
  Clock,
  Share2,
  Palette,
  Plus,
  Trash2,
  Check,
  Loader2,
  Image as ImageIcon,
  MapPin,
  MessageCircle,
  Mail,
  ChevronDown,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageUploader } from "@/components/ImageUploader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StorefrontConfig {
  heroHeadline: string;
  heroSubheadline: string;
  primaryButtonText?: string;
  secondaryButtonText?: string;
  coverImageUrl?: string;
  heroImageUrls: [string, string, string];
  address: string;
  cityStateZip: string;
}

interface OperatingHour {
  day: string;
  hours: string;
}

interface SocialLinks {
  whatsapp: string;
  instagram: string;
  email: string;
}

interface ThemeSettings {
  primaryColor: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily: string;
  buttonRadius: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_STOREFRONT: StorefrontConfig = {
  heroHeadline: "Discover Our Menu",
  heroSubheadline: "Fresh ingredients, crafted with care.",
  primaryButtonText: "Explore Our Menu",
  secondaryButtonText: "Visit Us",
  coverImageUrl: "",
  heroImageUrls: ["", "", ""],
  address: "12 Rustaveli Ave",
  cityStateZip: "Tbilisi, 0108",
};

const DEFAULT_HOURS: OperatingHour[] = [
  { day: "Mon – Fri", hours: "08:00 – 20:00" },
  { day: "Sat – Sun", hours: "09:00 – 18:00" },
];

const DEFAULT_SOCIALS: SocialLinks = {
  whatsapp: "",
  instagram: "",
  email: "",
};

const DEFAULT_THEME: ThemeSettings = {
  primaryColor: "#ffffff",
  backgroundColor: "#09090b",
  textColor: "#ffffff",
  fontFamily: "Inter",
  buttonRadius: "0.5rem",
};

// ─── Tab Config ───────────────────────────────────────────────────────────────

type TabId = "hero" | "hours" | "socials" | "theme" | "announcements";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "hero", label: "Hero & Location", icon: Store },
  { id: "hours", label: "Hours", icon: Clock },
  { id: "socials", label: "Socials", icon: Share2 },
  { id: "theme", label: "Theme", icon: Palette },
  { id: "announcements", label: "Announcements", icon: Bell },
];

const FONT_OPTIONS = ["Inter", "Roboto", "Playfair Display", "DM Sans", "Space Grotesk"];
const RADIUS_OPTIONS = [
  { label: "Sharp", value: "0px" },
  { label: "Rounded", value: "0.5rem" },
  { label: "Pill", value: "9999px" },
];

// ─── Shared primitives ────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </label>
      {hint && <p className="text-[11px] text-zinc-600 -mt-0.5">{hint}</p>}
      {children}
    </div>
  );
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none focus:bg-white/8 transition-all",
        props.className,
      )}
    />
  );
}

function TextArea({ ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none focus:bg-white/8 transition-all resize-none",
        props.className,
      )}
    />
  );
}

function SelectInput({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-10 text-sm text-white focus:border-white/25 focus:outline-none transition-all cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
    </div>
  );
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function HeroTab({
  data,
  onChange,
  cafeName,
}: {
  data: StorefrontConfig;
  onChange: (d: StorefrontConfig) => void;
  cafeName: string;
}) {
  function set<K extends keyof StorefrontConfig>(key: K, val: StorefrontConfig[K]) {
    onChange({ ...data, [key]: val });
  }

  function setImage(idx: number, val: string) {
    const next = [...data.heroImageUrls] as [string, string, string];
    next[idx] = val;
    onChange({ ...data, heroImageUrls: next });
  }

  return (
    <div className="space-y-5">
      <Field label="Hero Headline" hint="Main title shown on the menu PWA header.">
        <Input
          value={data.heroHeadline}
          onChange={(e) => set("heroHeadline", e.target.value)}
          placeholder="e.g. Discover Our Menu"
        />
      </Field>

      <Field label="Hero Sub-headline">
        <TextArea
          value={data.heroSubheadline}
          onChange={(e) => set("heroSubheadline", e.target.value)}
          rows={2}
          placeholder="e.g. Fresh ingredients, crafted with care."
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Primary Button Text">
          <Input
            value={data.primaryButtonText || ""}
            onChange={(e) => set("primaryButtonText", e.target.value)}
            placeholder="Explore Our Menu"
          />
        </Field>
        <Field label="Secondary Button Text">
          <Input
            value={data.secondaryButtonText || ""}
            onChange={(e) => set("secondaryButtonText", e.target.value)}
            placeholder="Visit Us"
          />
        </Field>
      </div>

      <Field label="Cover Image (Landing Page)" hint="Primary background image shown on the external directory.">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-32 aspect-video rounded-lg overflow-hidden bg-black/40 shrink-0 border border-white/10">
            {data.coverImageUrl ? (
              <img src={data.coverImageUrl} alt="Cover Preview" className="object-cover w-full h-full" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-white/20">
                <ImageIcon className="h-5 w-5 mb-1" />
                <span className="text-[10px] uppercase tracking-wider">No Image</span>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3 flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <ImageUploader
                itemName="cover-image"
                cafeName={cafeName}
                onSuccess={(res) => {
                  set("coverImageUrl", res.url || "");
                  setTimeout(() => document.getElementById("save-storefront-btn")?.click(), 250);
                }}
              />
              {data.coverImageUrl && (
                <button
                  type="button"
                  onClick={() => {
                    set("coverImageUrl", "");
                    setTimeout(() => document.getElementById("save-storefront-btn")?.click(), 250);
                  }}
                  className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors border border-transparent hover:border-red-400/20"
                  title="Remove Image"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <Input
              value={data.coverImageUrl || ""}
              onChange={(e) => set("coverImageUrl", e.target.value)}
              placeholder="Or paste Cover Image URL manually…"
              className="text-xs font-mono h-9"
            />
          </div>
        </div>
      </Field>

      <Field label="Hero Images (3 slots)" hint="Upload images for the floating hero visuals.">
        <div className="space-y-4">
          {([0, 1, 2] as const).map((idx) => (
            <div key={idx} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col sm:flex-row gap-4">
              <div className="relative w-24 aspect-[3/4] rounded-lg overflow-hidden bg-black/40 shrink-0 border border-white/10">
                {data.heroImageUrls[idx] ? (
                  <img src={data.heroImageUrls[idx]} alt={`Hero ${idx + 1}`} className="object-cover w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-white/20">
                    <ImageIcon className="h-4 w-4 mb-1" />
                    <span className="text-[10px] uppercase tracking-wider">Slot {idx + 1}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Image {idx + 1}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ImageUploader
                    itemName={`hero-image-${idx + 1}`}
                    cafeName={cafeName}
                    onSuccess={(res) => {
                      setImage(idx, res.url || "");
                      setTimeout(() => document.getElementById("save-storefront-btn")?.click(), 250);
                    }}
                  />
                  {data.heroImageUrls[idx] && (
                    <button
                      type="button"
                      onClick={() => {
                        setImage(idx, "");
                        setTimeout(() => document.getElementById("save-storefront-btn")?.click(), 250);
                      }}
                      className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors border border-transparent hover:border-red-400/20"
                      title="Remove Image"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <Input
                  value={data.heroImageUrls[idx]}
                  onChange={(e) => setImage(idx, e.target.value)}
                  placeholder={`Or paste Image ${idx + 1} URL manually…`}
                  className="text-xs font-mono h-9"
                />
              </div>
            </div>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Street Address">
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 pointer-events-none" />
            <Input
              value={data.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="12 Rustaveli Ave"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="City / Zip">
          <Input
            value={data.cityStateZip}
            onChange={(e) => set("cityStateZip", e.target.value)}
            placeholder="Tbilisi, 0108"
          />
        </Field>
      </div>
    </div>
  );
}

function HoursTab({
  data,
  onChange,
}: {
  data: OperatingHour[];
  onChange: (d: OperatingHour[]) => void;
}) {
  function addRow() {
    onChange([...data, { day: "", hours: "" }]);
  }

  function removeRow(idx: number) {
    onChange(data.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, key: keyof OperatingHour, val: string) {
    const next = data.map((row, i) => (i === idx ? { ...row, [key]: val } : row));
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Define your operating schedule. These appear in the Info section of the customer menu.
      </p>

      <div className="space-y-2">
        {data.map((row, idx) => (
          <div
            key={idx}
            className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/8 text-[10px] font-bold text-zinc-500">
              {idx + 1}
            </div>
            <Input
              value={row.day}
              onChange={(e) => updateRow(idx, "day", e.target.value)}
              placeholder="Mon – Fri"
              className="flex-1"
            />
            <span className="text-zinc-700 text-sm shrink-0">→</span>
            <Input
              value={row.hours}
              onChange={(e) => updateRow(idx, "hours", e.target.value)}
              placeholder="08:00 – 20:00"
              className="flex-1"
            />
            <button
              onClick={() => removeRow(idx)}
              className="shrink-0 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-3 text-xs font-medium text-zinc-500 hover:border-white/30 hover:text-white hover:bg-white/[0.03] transition-all"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Time Slot
      </button>
    </div>
  );
}

function SocialsTab({
  data,
  onChange,
}: {
  data: SocialLinks;
  onChange: (d: SocialLinks) => void;
}) {
  return (
    <div className="space-y-5">
      <Field label="WhatsApp" hint="Include country code, e.g. +995 555 000 000">
        <div className="relative">
          <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 pointer-events-none" />
          <Input
            value={data.whatsapp}
            onChange={(e) => onChange({ ...data, whatsapp: e.target.value })}
            placeholder="+995 555 000 000"
            className="pl-9"
          />
        </div>
      </Field>

      <Field label="Instagram" hint="Handle only, without @">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 pointer-events-none" />
          <Input
            value={data.instagram}
            onChange={(e) => onChange({ ...data, instagram: e.target.value })}
            placeholder="yourcafe"
            className="pl-9"
          />
        </div>
      </Field>

      <Field label="Email">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 pointer-events-none" />
          <Input
            value={data.email}
            onChange={(e) => onChange({ ...data, email: e.target.value })}
            placeholder="hello@yourcafe.ge"
            className="pl-9"
          />
        </div>
      </Field>

      {/* Preview pill */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Preview</p>
        <div className="flex flex-wrap gap-2">
          {data.whatsapp && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 border border-green-500/20 bg-green-500/5 rounded-full px-3 py-1.5">
              <MessageCircle className="h-3 w-3" /> {data.whatsapp}
            </span>
          )}
          {data.instagram && (
            <span className="flex items-center gap-1.5 text-xs text-pink-400 border border-pink-500/20 bg-pink-500/5 rounded-full px-3 py-1.5">
              <Mail className="h-3 w-3" /> @{data.instagram}
            </span>
          )}
          {data.email && (
            <span className="flex items-center gap-1.5 text-xs text-blue-400 border border-blue-500/20 bg-blue-500/5 rounded-full px-3 py-1.5">
              <Mail className="h-3 w-3" /> {data.email}
            </span>
          )}
          {!data.whatsapp && !data.instagram && !data.email && (
            <p className="text-xs text-zinc-700 italic">Fill in at least one field to preview.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeTab({
  data,
  onChange,
}: {
  data: ThemeSettings;
  onChange: (d: ThemeSettings) => void;
}) {
  return (
    <div className="space-y-5">
      <Field label="Primary Color" hint="Used for buttons, active states, and accent elements.">
        <div className="flex items-center gap-3">
          <div
            className="relative h-10 w-10 rounded-lg border border-white/20 overflow-hidden cursor-pointer shrink-0"
            style={{ backgroundColor: data.primaryColor }}
          >
            <input
              type="color"
              value={data.primaryColor.startsWith("#") ? data.primaryColor : "#ffffff"}
              onChange={(e) => onChange({ ...data, primaryColor: e.target.value })}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <Input
            value={data.primaryColor}
            onChange={(e) => onChange({ ...data, primaryColor: e.target.value })}
            placeholder="#ffffff"
            className="font-mono"
          />
        </div>
      </Field>

      <Field label="Background Color" hint="Primary background for the PWA menu.">
        <div className="flex items-center gap-3">
          <div
            className="relative h-10 w-10 rounded-lg border border-white/20 overflow-hidden cursor-pointer shrink-0"
            style={{ backgroundColor: data.backgroundColor || "#09090b" }}
          >
            <input
              type="color"
              value={data.backgroundColor || "#09090b"}
              onChange={(e) => onChange({ ...data, backgroundColor: e.target.value })}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <Input
            value={data.backgroundColor || ""}
            onChange={(e) => onChange({ ...data, backgroundColor: e.target.value })}
            placeholder="#09090b"
            className="font-mono"
          />
        </div>
      </Field>

      <Field label="Text Color" hint="Main body text color.">
        <div className="flex items-center gap-3">
          <div
            className="relative h-10 w-10 rounded-lg border border-white/20 overflow-hidden cursor-pointer shrink-0"
            style={{ backgroundColor: data.textColor || "#ffffff" }}
          >
            <input
              type="color"
              value={data.textColor || "#ffffff"}
              onChange={(e) => onChange({ ...data, textColor: e.target.value })}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <Input
            value={data.textColor || ""}
            onChange={(e) => onChange({ ...data, textColor: e.target.value })}
            placeholder="#ffffff"
            className="font-mono"
          />
        </div>
      </Field>

      <Field label="Font Family">
        <SelectInput
          value={data.fontFamily}
          onChange={(v) => onChange({ ...data, fontFamily: v })}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f} className="bg-zinc-900">{f}</option>
          ))}
        </SelectInput>
        {/* Typeface preview */}
        <div className="flex flex-wrap gap-2 mt-3">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => onChange({ ...data, fontFamily: f })}
              className={cn(
                "px-3 py-2 rounded-xl border text-xs transition-all",
                data.fontFamily === f
                  ? "border-white/30 bg-white/10 text-white"
                  : "border-white/10 bg-white/[0.02] text-zinc-500 hover:text-white hover:bg-white/5",
              )}
              style={{ fontFamily: f }}
            >
              {f}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Button Radius">
        <div className="flex gap-2">
          {RADIUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange({ ...data, buttonRadius: opt.value })}
              className={cn(
                "flex-1 py-2.5 text-xs font-medium border transition-all",
                opt.value === "0px" ? "rounded-none" : opt.value === "9999px" ? "rounded-full" : "rounded-xl",
                data.buttonRadius === opt.value
                  ? "border-white/30 bg-white/10 text-white"
                  : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:bg-white/5",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Live button preview */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 flex items-center gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 shrink-0">Preview</p>
        <button
          className="px-5 py-2.5 text-sm font-semibold text-black transition-all"
          style={{
            backgroundColor: data.primaryColor,
            borderRadius: data.buttonRadius,
            fontFamily: data.fontFamily,
          }}
        >
          Order Now
        </button>
      </div>
    </div>
  );
}

function AnnouncementsTab({
  alert,
  onChange,
}: {
  alert: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <Field label="Storefront Announcement" hint="This message will be displayed as a popup banner to all visitors.">
        <TextArea
          value={alert}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="e.g. We are closed for renovation this weekend."
        />
      </Field>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 flex flex-col gap-2">
         <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Note</p>
         <p className="text-xs text-zinc-400">
           To remove the announcement, simply clear the text box and click "Save Changes". The AI agent can also update this automatically if instructed.
         </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StorefrontPage() {
  const { organization, isLoaded } = useOrganization();
  const orgId = organization?.id;

  // Convex data
  const config = useQuery(
    api.organizations.getStorefrontConfig,
    orgId ? { orgId } : "skip",
  );
  const saveConfig = useMutation(api.organizations.updateStorefrontConfig);

  // Local state
  const [activeTab, setActiveTab] = useState<TabId>("hero");
  const [storefront, setStorefront] = useState<StorefrontConfig>(DEFAULT_STOREFRONT);
  const [hours, setHours] = useState<OperatingHour[]>(DEFAULT_HOURS);
  const [socials, setSocials] = useState<SocialLinks>(DEFAULT_SOCIALS);
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [storefrontAlert, setStorefrontAlert] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Hydrate from Convex once data arrives
  useEffect(() => {
    if (!config) return;
    if (config.storefrontConfig) setStorefront(config.storefrontConfig as StorefrontConfig);
    if (config.operatingHours) setHours(config.operatingHours);
    if (config.socialLinks) setSocials({ whatsapp: "", instagram: "", email: "", ...config.socialLinks });
    if (config.themeSettings) setTheme(config.themeSettings);
    if (config.storefrontAlert !== undefined) setStorefrontAlert(config.storefrontAlert || "");
  }, [config]);

  async function handleSave() {
    if (!orgId) return;
    setSaving(true);
    try {
      console.log("💾 [StorefrontConfig] Saving to Convex:", {
        orgId,
        storefrontConfig: storefront,
        operatingHours: hours,
        socialLinks: { whatsapp: socials.whatsapp || undefined, instagram: socials.instagram || undefined, email: socials.email || undefined },
        themeSettings: theme,
        storefrontAlert: storefrontAlert || undefined,
      });

      // ── Wire up to Convex ────────────────────────────────────
      await saveConfig({
        orgId,
        storefrontConfig: storefront,
        operatingHours: hours,
        socialLinks: {
          whatsapp: socials.whatsapp || undefined,
          instagram: socials.instagram || undefined,
          email: socials.email || undefined,
        },
        themeSettings: theme,
        storefrontAlert: storefrontAlert || undefined,
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      console.error("Save config error:", err);
      alert(`Failed to save configuration: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!isLoaded || config === undefined) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-8 w-48 rounded-xl bg-white/5 animate-pulse mb-2" />
          <div className="h-4 w-72 rounded-lg bg-white/5 animate-pulse" />
        </div>
        <div className="h-[500px] rounded-2xl bg-white/[0.02] border border-white/10 animate-pulse" />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Store className="h-8 w-8 text-zinc-600" />
        <p className="font-medium text-white">No workspace selected</p>
        <p className="text-sm text-zinc-400 max-w-xs">
          Select a workspace from the sidebar to configure its storefront.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Store className="h-4 w-4 text-white" />
            <h1 className="text-3xl font-medium tracking-tight text-white">
              Storefront
            </h1>
          </div>
          <p className="text-sm text-zinc-400">
            Configure the public-facing menu for{" "}
            <span className="text-white font-medium">{organization?.name}</span>.
            Changes are pushed to the PWA instantly on save.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-200",
            saved
              ? "bg-white/10 text-white border border-white/20"
              : saving
                ? "bg-white/80 text-black cursor-not-allowed"
                : "bg-white text-black hover:bg-zinc-200",
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saved ? "Saved!" : saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {/* Tab bar */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-75 fill-mode-both flex gap-1 rounded-2xl border border-white/10 bg-[#09090b] p-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition-all duration-150",
              activeTab === id
                ? "bg-white/10 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:block">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both bg-[#09090b] border border-white/10 rounded-2xl p-6">
        {activeTab === "hero" && (
          <HeroTab data={storefront} onChange={setStorefront} cafeName={organization?.name || "cafe"} />
        )}
        {activeTab === "hours" && (
          <HoursTab data={hours} onChange={setHours} />
        )}
        {activeTab === "socials" && (
          <SocialsTab data={socials} onChange={setSocials} />
        )}
        {activeTab === "theme" && (
          <ThemeTab data={theme} onChange={setTheme} />
        )}
        {activeTab === "announcements" && (
          <AnnouncementsTab alert={storefrontAlert} onChange={setStorefrontAlert} />
        )}
      </div>

      {/* Inline save at bottom */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200 fill-mode-both">
        <button
          id="save-storefront-btn"
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all",
            saved
              ? "bg-white/10 text-white border border-white/20"
              : saving
                ? "bg-white/80 text-black cursor-not-allowed"
                : "bg-white text-black hover:bg-zinc-200",
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "All changes saved!" : saving ? "Saving…" : "Save All Changes"}
        </button>
        <p className="text-center text-[10px] text-zinc-700 mt-2">
          Ready to connect to{" "}
          <code className="font-mono text-zinc-600">
            api.organizations.updateStorefrontConfig
          </code>
        </p>
      </div>
    </div>
  );
}
