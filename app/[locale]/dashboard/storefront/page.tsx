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
import { LocationPickerMap } from "@/components/maps/LocationPickerMap";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StorefrontConfig {
  heroHeadline: any;
  heroSubheadline: any;
  primaryButtonText?: any;
  secondaryButtonText?: any;
  coverImageUrl?: string;
  heroImageUrls: [string, string, string];
  address: any;
  cityStateZip: any;
}

function getI18nStr(val: any, lang: string): string {
  if (!val) return "";
  if (typeof val === "string") return lang === "en" ? val : "";
  return val[lang] || "";
}

function updateI18nStr(val: any, lang: string, newStr: string): Record<string, string> {
  const res: Record<string, string> = typeof val === "string" ? { en: val } : { ...(val || {}) };
  res[lang] = newStr;
  return res;
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
  menuType?: "basic" | "dragable";
  categoryLayout?: "pills" | "cards";
}

interface Announcement {
  id: string;
  message: string;
  isActive: boolean;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_STOREFRONT: StorefrontConfig = {
  heroHeadline: { en: "Discover Our Menu" },
  heroSubheadline: { en: "Fresh ingredients, crafted with care." },
  primaryButtonText: { en: "Explore Our Menu" },
  secondaryButtonText: { en: "Visit Us" },
  coverImageUrl: "",
  heroImageUrls: ["", "", ""],
  address: { en: "12 Rustaveli Ave" },
  cityStateZip: { en: "Tbilisi, 0108" },
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
  menuType: "basic",
  categoryLayout: "pills",
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
      <label className="v-t-micro block text-v-faint">
        {label}
      </label>
      {hint && <p className="-mt-0.5 text-[11px] text-v-faint">{hint}</p>}
      {children}
    </div>
  );
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full min-w-0 rounded-v border border-v-line bg-white/[0.03] px-4 py-2.5 text-sm text-v-ink placeholder:text-v-faint transition-all focus:border-v-accent focus:bg-white/[0.05] focus:outline-none",
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
        "w-full rounded-v border border-v-line bg-white/[0.03] px-4 py-2.5 text-sm text-v-ink placeholder:text-v-faint transition-all focus:border-v-accent focus:bg-white/[0.05] focus:outline-none resize-none",
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
        className="w-full cursor-pointer appearance-none rounded-v border border-v-line bg-white/[0.03] px-4 py-2.5 pr-10 text-sm text-v-ink transition-all focus:border-v-accent focus:outline-none [color-scheme:dark]"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-v-faint" />
    </div>
  );
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function HeroTab({
  data,
  onChange,
  cafeName,
  lat,
  lng,
  onLocationChange,
}: {
  data: StorefrontConfig;
  onChange: (d: StorefrontConfig) => void;
  cafeName: string;
  lat?: number;
  lng?: number;
  onLocationChange?: (lat: number, lng: number) => void;
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
      <div className="space-y-3">
        <Field label="Hero Headline (EN)" hint="Main title shown on the menu PWA header.">
          <Input
            value={getI18nStr(data.heroHeadline, "en")}
            onChange={(e) => set("heroHeadline", updateI18nStr(data.heroHeadline, "en", e.target.value))}
            placeholder="e.g. Discover Our Menu"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Hero Headline (KA)">
            <Input
              value={getI18nStr(data.heroHeadline, "ka")}
              onChange={(e) => set("heroHeadline", updateI18nStr(data.heroHeadline, "ka", e.target.value))}
              placeholder="e.g. აღმოაჩინეთ ჩვენი მენიუ"
            />
          </Field>
          <Field label="Hero Headline (RU)">
            <Input
              value={getI18nStr(data.heroHeadline, "ru")}
              onChange={(e) => set("heroHeadline", updateI18nStr(data.heroHeadline, "ru", e.target.value))}
              placeholder="e.g. Откройте для себя наше меню"
            />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Hero Sub-headline (EN)">
          <TextArea
            value={getI18nStr(data.heroSubheadline, "en")}
            onChange={(e) => set("heroSubheadline", updateI18nStr(data.heroSubheadline, "en", e.target.value))}
            rows={2}
            placeholder="e.g. Fresh ingredients, crafted with care."
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Hero Sub-headline (KA)">
            <TextArea
              value={getI18nStr(data.heroSubheadline, "ka")}
              onChange={(e) => set("heroSubheadline", updateI18nStr(data.heroSubheadline, "ka", e.target.value))}
              rows={2}
              placeholder="e.g. ახალი ინგრედიენტები..."
            />
          </Field>
          <Field label="Hero Sub-headline (RU)">
            <TextArea
              value={getI18nStr(data.heroSubheadline, "ru")}
              onChange={(e) => set("heroSubheadline", updateI18nStr(data.heroSubheadline, "ru", e.target.value))}
              rows={2}
              placeholder="e.g. Свежие ингредиенты..."
            />
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-3">
          <Field label="Primary Button Text (EN)">
            <Input
              value={getI18nStr(data.primaryButtonText, "en")}
              onChange={(e) => set("primaryButtonText", updateI18nStr(data.primaryButtonText, "en", e.target.value))}
              placeholder="Explore Our Menu"
            />
          </Field>
          <div className="flex gap-2">
            <Input
              value={getI18nStr(data.primaryButtonText, "ka")}
              onChange={(e) => set("primaryButtonText", updateI18nStr(data.primaryButtonText, "ka", e.target.value))}
              placeholder="KA Text"
            />
            <Input
              value={getI18nStr(data.primaryButtonText, "ru")}
              onChange={(e) => set("primaryButtonText", updateI18nStr(data.primaryButtonText, "ru", e.target.value))}
              placeholder="RU Text"
            />
          </div>
        </div>
        <div className="space-y-3">
          <Field label="Secondary Button Text (EN)">
            <Input
              value={getI18nStr(data.secondaryButtonText, "en")}
              onChange={(e) => set("secondaryButtonText", updateI18nStr(data.secondaryButtonText, "en", e.target.value))}
              placeholder="Visit Us"
            />
          </Field>
          <div className="flex gap-2">
            <Input
              value={getI18nStr(data.secondaryButtonText, "ka")}
              onChange={(e) => set("secondaryButtonText", updateI18nStr(data.secondaryButtonText, "ka", e.target.value))}
              placeholder="KA Text"
            />
            <Input
              value={getI18nStr(data.secondaryButtonText, "ru")}
              onChange={(e) => set("secondaryButtonText", updateI18nStr(data.secondaryButtonText, "ru", e.target.value))}
              placeholder="RU Text"
            />
          </div>
        </div>
      </div>

      <Field label="Cover Image (Landing Page)" hint="Primary background image shown on the external directory.">
        <div className="rounded-v border border-v-line bg-white/[0.02] p-4 flex flex-col sm:flex-row gap-4">
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-v border border-v-line bg-v-bg sm:w-32">
            {data.coverImageUrl ? (
              <img src={data.coverImageUrl} alt="Cover Preview" className="object-cover w-full h-full" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center text-v-faint">
                <ImageIcon className="mb-1 h-5 w-5" />
                <span className="v-t-micro">No Image</span>
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
                  className="rounded-v border border-transparent p-2 text-v-mut transition-colors hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-400"
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
            <div key={idx} className="rounded-v border border-v-line bg-white/[0.02] p-4 flex flex-col sm:flex-row gap-4">
              <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-v border border-v-line bg-v-bg">
                {data.heroImageUrls[idx] ? (
                  <img src={data.heroImageUrls[idx]} alt={`Hero ${idx + 1}`} className="object-cover w-full h-full" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center text-v-faint">
                    <ImageIcon className="mb-1 h-4 w-4" />
                    <span className="v-t-micro">Slot {idx + 1}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-1">
                  <span className="v-t-micro text-v-mut">Image {idx + 1}</span>
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
                      className="rounded-v border border-transparent p-2 text-v-mut transition-colors hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-400"
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-3">
          <Field label="Street Address (EN)">
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-v-faint pointer-events-none" />
              <Input
                value={getI18nStr(data.address, "en")}
                onChange={(e) => set("address", updateI18nStr(data.address, "en", e.target.value))}
                placeholder="12 Rustaveli Ave"
                className="pl-9"
              />
            </div>
          </Field>
          <div className="flex gap-2">
            <Input
              value={getI18nStr(data.address, "ka")}
              onChange={(e) => set("address", updateI18nStr(data.address, "ka", e.target.value))}
              placeholder="KA Address"
            />
            <Input
              value={getI18nStr(data.address, "ru")}
              onChange={(e) => set("address", updateI18nStr(data.address, "ru", e.target.value))}
              placeholder="RU Address"
            />
          </div>
        </div>
        <div className="space-y-3">
          <Field label="City / Zip (EN)">
            <Input
              value={getI18nStr(data.cityStateZip, "en")}
              onChange={(e) => set("cityStateZip", updateI18nStr(data.cityStateZip, "en", e.target.value))}
              placeholder="Tbilisi, 0108"
            />
          </Field>
          <div className="flex gap-2">
            <Input
              value={getI18nStr(data.cityStateZip, "ka")}
              onChange={(e) => set("cityStateZip", updateI18nStr(data.cityStateZip, "ka", e.target.value))}
              placeholder="KA City/Zip"
            />
            <Input
              value={getI18nStr(data.cityStateZip, "ru")}
              onChange={(e) => set("cityStateZip", updateI18nStr(data.cityStateZip, "ru", e.target.value))}
              placeholder="RU City/Zip"
            />
          </div>
        </div>
      </div>

      <Field label="Precise Map Location" hint="Search for your address or drag the pin to set your exact venue location on the map.">
        <div className="relative overflow-hidden rounded-v border border-v-line" style={{ height: 320 }}>
          <LocationPickerMap
            lat={lat}
            lng={lng}
            onChange={(newLat, newLng) => {
              if (onLocationChange) onLocationChange(newLat, newLng);
              setTimeout(() => document.getElementById("save-storefront-btn")?.click(), 250);
            }}
          />
        </div>
      </Field>
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
      <p className="text-xs text-v-faint">
        Define your operating schedule. These appear in the Info section of the customer menu.
      </p>

      <div className="space-y-2">
        {data.map((row, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-v border border-v-line bg-white/[0.02] px-3 py-3 sm:gap-3 sm:px-4"
          >
            <div className="v-t-micro flex h-6 w-6 shrink-0 items-center justify-center rounded-v border border-v-line tabular-nums text-v-faint">
              {idx + 1}
            </div>
            <Input
              value={row.day}
              onChange={(e) => updateRow(idx, "day", e.target.value)}
              placeholder="Mon – Fri"
              className="flex-1"
            />
            <span className="hidden shrink-0 text-sm text-v-faint sm:block">→</span>
            <Input
              value={row.hours}
              onChange={(e) => updateRow(idx, "hours", e.target.value)}
              placeholder="08:00 – 20:00"
              className="flex-1 font-v-mono tabular-nums"
            />
            <button
              onClick={() => removeRow(idx)}
              className="shrink-0 rounded-v p-1.5 text-v-faint transition-all hover:bg-red-400/10 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="v-t-micro flex w-full items-center justify-center gap-2 rounded-v border border-dashed border-v-line py-3 text-v-faint transition-all hover:bg-white/[0.03] hover:text-v-ink"
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
          <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-v-faint pointer-events-none" />
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
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-v-faint pointer-events-none" />
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
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-v-faint pointer-events-none" />
          <Input
            value={data.email}
            onChange={(e) => onChange({ ...data, email: e.target.value })}
            placeholder="hello@yourcafe.ge"
            className="pl-9"
          />
        </div>
      </Field>

      {/* Preview pill */}
      <div className="space-y-2 rounded-v border border-v-line bg-white/[0.02] p-4">
        <p className="v-t-micro text-v-faint">Preview</p>
        <div className="flex flex-wrap gap-2">
          {data.whatsapp && (
            <span className="flex items-center gap-1.5 rounded-full border border-v-line px-3 py-1.5 text-xs text-v-mut">
              <MessageCircle className="h-3 w-3" /> {data.whatsapp}
            </span>
          )}
          {data.instagram && (
            <span className="flex items-center gap-1.5 rounded-full border border-v-line px-3 py-1.5 text-xs text-v-mut">
              <Mail className="h-3 w-3" /> @{data.instagram}
            </span>
          )}
          {data.email && (
            <span className="flex items-center gap-1.5 rounded-full border border-v-line px-3 py-1.5 text-xs text-v-mut">
              <Mail className="h-3 w-3" /> {data.email}
            </span>
          )}
          {!data.whatsapp && !data.instagram && !data.email && (
            <p className="text-xs italic text-v-faint">Fill in at least one field to preview.</p>
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
            className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-v border border-v-line"
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
            className="font-v-mono"
          />
        </div>
      </Field>

      <Field label="Background Color" hint="Primary background for the PWA menu.">
        <div className="flex items-center gap-3">
          <div
            className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-v border border-v-line"
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
            className="font-v-mono"
          />
        </div>
      </Field>

      <Field label="Text Color" hint="Main body text color.">
        <div className="flex items-center gap-3">
          <div
            className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-v border border-v-line"
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
            className="font-v-mono"
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
                "rounded-v border px-3 py-2 text-xs transition-all",
                data.fontFamily === f
                  ? "border-v-accent/50 bg-v-accent/[0.06] text-v-ink"
                  : "border-v-line bg-white/[0.02] text-v-faint hover:bg-white/[0.04] hover:text-v-ink",
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
                  ? "border-v-accent/50 bg-v-accent/[0.06] text-v-ink"
                  : "border-v-line bg-white/[0.02] text-v-mut hover:bg-white/[0.04] hover:text-v-ink",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Menu Layout" hint="Choose the navigation style for your public menu.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {/* Basic Layout Card */}
          <button
            onClick={() => onChange({ ...data, menuType: "basic" })}
            className={cn(
              "flex flex-col items-start gap-2 p-4 rounded-v border text-left transition-all relative overflow-hidden group",
              (!data.menuType || data.menuType === "basic")
                ? "border-v-accent/50 bg-v-accent/[0.07]"
                : "border-v-line bg-white/[0.02] hover:bg-white/[0.04]"
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className={cn(
                "text-sm font-semibold",
                (!data.menuType || data.menuType === "basic") ? "text-v-accent" : "text-v-ink"
              )}>
                Classic Scroll
              </span>
              {(!data.menuType || data.menuType === "basic") && (
                <Check className="h-4 w-4 text-v-accent" />
              )}
            </div>
            <p className="text-xs text-v-mut">Traditional vertical scrolling list with category tabs.</p>
          </button>

          {/* Dragable Map Layout Card */}
          <button
            onClick={() => onChange({ ...data, menuType: "dragable" })}
            className={cn(
              "flex flex-col items-start gap-2 p-4 rounded-v border text-left transition-all relative overflow-hidden group",
              data.menuType === "dragable"
                ? "border-v-accent/50 bg-v-accent/[0.07]"
                : "border-v-line bg-white/[0.02] hover:bg-white/[0.04]"
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className={cn(
                "text-sm font-semibold",
                data.menuType === "dragable" ? "text-v-accent" : "text-v-ink"
              )}>
                Spatial Map
              </span>
              {data.menuType === "dragable" && (
                <Check className="h-4 w-4 text-v-accent" />
              )}
            </div>
            <p className="text-xs text-v-mut">Interactive 2D drag-to-explore canvas experience.</p>
          </button>
        </div>
      </Field>

      <Field label="Category Layout" hint="Choose how categories are displayed in the Classic Scroll menu.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {/* Pills Layout Card */}
          <button
            onClick={() => onChange({ ...data, categoryLayout: "pills" })}
            className={cn(
              "flex flex-col items-start gap-2 p-4 rounded-v border text-left transition-all relative overflow-hidden group",
              (!data.categoryLayout || data.categoryLayout === "pills")
                ? "border-v-accent/50 bg-v-accent/[0.07]"
                : "border-v-line bg-white/[0.02] hover:bg-white/[0.04]"
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className={cn(
                "text-sm font-semibold",
                (!data.categoryLayout || data.categoryLayout === "pills") ? "text-v-accent" : "text-v-ink"
              )}>
                Pill Navigation
              </span>
              {(!data.categoryLayout || data.categoryLayout === "pills") && (
                <Check className="h-4 w-4 text-v-accent" />
              )}
            </div>
            <p className="text-xs text-v-mut">Horizontal scrolling pills. Products listed below.</p>
          </button>

          {/* Cards Layout Card */}
          <button
            onClick={() => onChange({ ...data, categoryLayout: "cards" })}
            className={cn(
              "flex flex-col items-start gap-2 p-4 rounded-v border text-left transition-all relative overflow-hidden group",
              data.categoryLayout === "cards"
                ? "border-v-accent/50 bg-v-accent/[0.07]"
                : "border-v-line bg-white/[0.02] hover:bg-white/[0.04]"
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className={cn(
                "text-sm font-semibold",
                data.categoryLayout === "cards" ? "text-v-accent" : "text-v-ink"
              )}>
                Visual Cards
              </span>
              {data.categoryLayout === "cards" && (
                <Check className="h-4 w-4 text-v-accent" />
              )}
            </div>
            <p className="text-xs text-v-mut">Grid of category cards. Products open in a popup.</p>
          </button>
        </div>
      </Field>

      {/* Live button preview */}
      <div className="flex items-center gap-4 rounded-v border border-v-line bg-white/[0.02] p-4">
        <p className="v-t-micro shrink-0 text-v-faint">Preview</p>
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
  data,
  onChange,
}: {
  data: Announcement[];
  onChange: (d: Announcement[]) => void;
}) {
  function addRow() {
    if (data.length >= 5) return;
    onChange([{ id: crypto.randomUUID(), message: "", isActive: true }, ...data]);
  }

  function removeRow(id: string) {
    onChange(data.filter((a) => a.id !== id));
  }

  function updateRow(id: string, key: keyof Announcement, val: any) {
    onChange(data.map((a) => (a.id === id ? { ...a, [key]: val } : a)));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-v-faint">
          Create up to 5 announcements. Toggle them live to show as popup banners.
        </p>
        <span className="v-t-micro tabular-nums text-v-faint">
          {data.length} / 5
        </span>
      </div>

      <div className="space-y-3">
        {data.map((row, idx) => (
          <div
            key={row.id}
            className="flex flex-col gap-3 rounded-v border border-v-line bg-white/[0.02] p-4"
          >
            <div className="flex items-center justify-between">
              <span className="v-t-micro text-v-faint">
                Announcement {idx + 1}
              </span>
              <div className="flex items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <span className={cn("v-t-micro", row.isActive ? "text-v-accent" : "text-v-faint")}>
                    {row.isActive ? "Live" : "Closed"}
                  </span>
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(e) => updateRow(row.id, "isActive", e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded-v border-v-line accent-[#D8FF3A]"
                  />
                </label>
                <button
                  onClick={() => removeRow(row.id)}
                  className="text-v-faint transition-colors hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <TextArea
              value={row.message}
              onChange={(e) => updateRow(row.id, "message", e.target.value)}
              rows={2}
              placeholder="e.g. We are closed for renovation this weekend."
              className="text-sm"
            />
          </div>
        ))}

        {data.length === 0 && (
          <div className="rounded-v border border-dashed border-v-line p-8 text-center">
            <p className="text-sm text-v-faint">No announcements created yet.</p>
          </div>
        )}
      </div>

      {data.length < 5 && (
        <button
          onClick={addRow}
          className="v-t-micro flex w-full items-center justify-center gap-2 rounded-v border border-dashed border-v-line py-3 text-v-faint transition-all hover:bg-white/[0.03] hover:text-v-ink"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Announcement
        </button>
      )}
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
  const venueRecord = useQuery(
    api.venues.getByOrgId as any, // Type cast for now until codegen runs
    orgId ? { orgId } : "skip"
  );
  const saveLocation = useMutation(api.venues.updateLocation as any);

  // Local state
  const [activeTab, setActiveTab] = useState<TabId>("hero");
  const [storefront, setStorefront] = useState<StorefrontConfig>(DEFAULT_STOREFRONT);
  const [hours, setHours] = useState<OperatingHour[]>(DEFAULT_HOURS);
  const [socials, setSocials] = useState<SocialLinks>(DEFAULT_SOCIALS);
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Hydrate from Convex once data arrives
  useEffect(() => {
    if (!config) return;
    if (config.storefrontConfig) setStorefront(config.storefrontConfig as StorefrontConfig);
    if (config.operatingHours) setHours(config.operatingHours);
    if (config.socialLinks) setSocials({ whatsapp: "", instagram: "", email: "", ...config.socialLinks });
    if (config.themeSettings) setTheme(config.themeSettings);
    if (config.announcements) setAnnouncements(config.announcements);
  }, [config]);

  useEffect(() => {
    if (venueRecord && venueRecord.lat && venueRecord.lng) {
      setLat(venueRecord.lat);
      setLng(venueRecord.lng);
    }
  }, [venueRecord]);

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
        announcements,
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
        announcements,
      });

      if (lat !== undefined && lng !== undefined) {
        await saveLocation({ orgId, lat, lng });
      }

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
          <div className="mb-2 h-8 w-48 animate-pulse rounded-v bg-white/[0.05]" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded-v bg-white/[0.03]" />
        </div>
        <div className="h-[500px] animate-pulse rounded-v border border-v-line bg-white/[0.02]" />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Store className="h-8 w-8 text-v-faint" />
        <p className="font-medium text-v-ink">No workspace selected</p>
        <p className="max-w-xs text-sm text-v-mut">
          Select a workspace from the sidebar to configure its storefront.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 text-v-ink">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Store className="h-4 w-4 text-v-mut" />
            <h1 className="font-v-display text-2xl font-medium tracking-tight text-v-ink sm:text-3xl">
              Storefront
            </h1>
          </div>
          <p className="text-sm text-v-mut">
            Configure the public-facing menu for{" "}
            <span className="font-medium text-v-ink">{organization?.name}</span>.
            Changes are pushed to the PWA instantly on save.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "v-press flex items-center gap-2 rounded-v px-5 py-2.5 text-sm font-semibold transition-all duration-200",
            saved
              ? "border border-v-line text-v-ink"
              : saving
                ? "cursor-not-allowed bg-v-accent/80 text-v-accent-ink"
                : "bg-v-accent text-v-accent-ink hover:brightness-95",
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
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-75 fill-mode-both flex divide-x divide-v-line overflow-hidden rounded-v border border-v-line bg-v-bg-raise">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "v-t-micro flex min-w-0 flex-1 items-center justify-center gap-2 px-3 py-2.5 transition-colors duration-150",
              activeTab === id
                ? "bg-white/[0.05] text-v-accent"
                : "text-v-faint hover:bg-white/[0.03] hover:text-v-mut",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden truncate sm:block">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both rounded-v border border-v-line bg-v-bg-raise p-4 sm:p-6">
        {activeTab === "hero" && (
          <HeroTab 
            data={storefront} 
            onChange={setStorefront} 
            cafeName={organization?.name || "cafe"} 
            lat={lat}
            lng={lng}
            onLocationChange={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
            }}
          />
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
          <AnnouncementsTab data={announcements} onChange={setAnnouncements} />
        )}
      </div>

      {/* Inline save at bottom */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200 fill-mode-both">
        <button
          id="save-storefront-btn"
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "v-press flex w-full items-center justify-center gap-2 rounded-v py-3.5 text-sm font-semibold transition-all",
            saved
              ? "border border-v-line text-v-ink"
              : saving
                ? "cursor-not-allowed bg-v-accent/80 text-v-accent-ink"
                : "bg-v-accent text-v-accent-ink hover:brightness-95",
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "All changes saved!" : saving ? "Saving…" : "Save All Changes"}
        </button>
        <p className="v-t-micro mt-2 text-center text-v-faint">
          Ready to connect to{" "}
          <code className="font-v-mono">
            api.organizations.updateStorefrontConfig
          </code>
        </p>
      </div>
    </div>
  );
}
