"use client";

import { useState } from "react";
import { ImageUploader } from "@/components/ImageUploader";
import { LocationPickerMap } from "@/components/maps/LocationPickerMap";
import {
  PanelSection,
  Field,
  GInput,
  GTextArea,
  Toggle,
  LangSwitch,
  type ContentLang,
} from "../_studio/controls";
import {
  Image as ImageIcon,
  Mail,
  MessageCircle,
  Camera,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Content & Venue panels — everything the old Storefront tabs edited, now in
// iOS-grouped glass cards with a single language switch instead of triple
// inputs. All changes flow through patch() and autosave live.
// ─────────────────────────────────────────────────────────────────────────────

export type I18nRecord = Record<string, string>;

export interface StorefrontContent {
  heroHeadline: I18nRecord;
  heroSubheadline: I18nRecord;
  primaryButtonText: I18nRecord;
  secondaryButtonText: I18nRecord;
  coverImageUrl: string;
  heroImageUrls: [string, string, string];
  address: I18nRecord;
  cityStateZip: I18nRecord;
}

export interface OperatingHour {
  day: string;
  hours: string;
}

export interface SocialLinksContent {
  whatsapp: string;
  instagram: string;
  email: string;
}

export interface Announcement {
  id: string;
  message: string;
  isActive: boolean;
}

/** Normalize legacy string-or-record values into a record. */
export function toRecord(val: unknown): I18nRecord {
  if (!val) return {};
  if (typeof val === "string") return val ? { en: val } : {};
  return { ...(val as I18nRecord) };
}

// ── Small composites ─────────────────────────────────────────────────────────

function MultiText({
  label,
  value,
  onChange,
  lang,
  placeholder,
  textarea = false,
  rows = 2,
}: {
  label: string;
  value: I18nRecord;
  onChange: (v: I18nRecord) => void;
  lang: ContentLang;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
}) {
  const set = (text: string) => onChange({ ...value, [lang]: text });
  return (
    <Field label={label}>
      {textarea ? (
        <GTextArea
          rows={rows}
          value={value[lang] ?? ""}
          onChange={(e) => set(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <GInput
          value={value[lang] ?? ""}
          onChange={(e) => set(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
}

function ImageSlot({
  label,
  url,
  onSet,
  cafeName,
  itemName,
  aspect = "aspect-video",
  folder,
}: {
  label: string;
  url: string;
  onSet: (url: string) => void;
  cafeName: string;
  itemName: string;
  aspect?: string;
  folder?: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <div
        className={cn(
          "relative w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40",
          aspect,
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-v-faint">
            <ImageIcon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div className="flex items-center gap-2">
          <span className="v-t-micro text-v-faint">{label}</span>
          {url && (
            <button
              type="button"
              onClick={() => onSet("")}
              className="ml-auto rounded-lg p-1.5 text-v-faint transition-colors hover:bg-red-400/10 hover:text-red-400"
              title="Remove image"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ImageUploader
            itemName={itemName}
            cafeName={cafeName}
            {...(folder ? { folder } : {})}
            onSuccess={(res: { url?: string }) => onSet(res.url || "")}
          />
        </div>
        <GInput
          value={url}
          onChange={(e) => onSet(e.target.value)}
          placeholder="Or paste an image URL…"
          className="h-8 font-v-mono text-[11px]"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT — hero copy, imagery, location
// ─────────────────────────────────────────────────────────────────────────────
export function ContentPanel({
  storefront,
  onStorefront,
  lat,
  lng,
  onLocation,
  cafeName,
}: {
  storefront: StorefrontContent;
  onStorefront: (s: StorefrontContent) => void;
  lat?: number;
  lng?: number;
  onLocation: (lat: number, lng: number) => void;
  cafeName: string;
}) {
  const [lang, setLang] = useState<ContentLang>("en");
  const set = <K extends keyof StorefrontContent>(
    key: K,
    val: StorefrontContent[K],
  ) => onStorefront({ ...storefront, [key]: val });

  const setImage = (idx: number, val: string) => {
    const next = [...storefront.heroImageUrls] as [string, string, string];
    next[idx] = val;
    set("heroImageUrls", next);
  };

  return (
    <>
      <PanelSection index="01" label="Hero copy">
        <div className="-mb-1 flex justify-end">
          <LangSwitch value={lang} onChange={setLang} />
        </div>
        <MultiText
          label="Headline"
          value={storefront.heroHeadline}
          onChange={(v) => set("heroHeadline", v)}
          lang={lang}
          placeholder={lang === "ka" ? "აღმოაჩინეთ ჩვენი მენიუ" : lang === "ru" ? "Откройте наше меню" : "Discover Our Menu"}
        />
        <MultiText
          label="Sub-headline"
          value={storefront.heroSubheadline}
          onChange={(v) => set("heroSubheadline", v)}
          lang={lang}
          textarea
          placeholder={lang === "en" ? "Fresh ingredients, crafted with care." : ""}
        />
        <div className="grid grid-cols-2 gap-3">
          <MultiText
            label="Primary button"
            value={storefront.primaryButtonText}
            onChange={(v) => set("primaryButtonText", v)}
            lang={lang}
            placeholder="Explore Our Menu"
          />
          <MultiText
            label="Secondary button"
            value={storefront.secondaryButtonText}
            onChange={(v) => set("secondaryButtonText", v)}
            lang={lang}
            placeholder="Visit Us"
          />
        </div>
      </PanelSection>

      <PanelSection index="02" label="Imagery">
        <ImageSlot
          label="Cover image"
          url={storefront.coverImageUrl}
          onSet={(u) => set("coverImageUrl", u)}
          cafeName={cafeName}
          itemName="cover-image"
        />
        {([0, 1, 2] as const).map((idx) => (
          <ImageSlot
            key={idx}
            label={`Hero image ${idx + 1}`}
            url={storefront.heroImageUrls[idx]}
            onSet={(u) => setImage(idx, u)}
            cafeName={cafeName}
            itemName={`hero-image-${idx + 1}`}
            aspect="aspect-[3/4]"
          />
        ))}
      </PanelSection>

      <PanelSection index="03" label="Location">
        <div className="-mb-1 flex justify-end">
          <LangSwitch value={lang} onChange={setLang} />
        </div>
        <MultiText
          label="Street address"
          value={storefront.address}
          onChange={(v) => set("address", v)}
          lang={lang}
          placeholder="12 Rustaveli Ave"
        />
        <MultiText
          label="City / zip"
          value={storefront.cityStateZip}
          onChange={(v) => set("cityStateZip", v)}
          lang={lang}
          placeholder="Tbilisi, 0108"
        />
        <Field label="Pin on the map" hint="Drag the pin to your exact door">
          <div className="overflow-hidden rounded-xl border border-white/10" style={{ height: 260 }}>
            <LocationPickerMap lat={lat} lng={lng} onChange={onLocation} />
          </div>
        </Field>
      </PanelSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VENUE — hours, socials, announcements
// ─────────────────────────────────────────────────────────────────────────────
export function VenuePanel({
  hours,
  onHours,
  socials,
  onSocials,
  announcements,
  onAnnouncements,
}: {
  hours: OperatingHour[];
  onHours: (h: OperatingHour[]) => void;
  socials: SocialLinksContent;
  onSocials: (s: SocialLinksContent) => void;
  announcements: Announcement[];
  onAnnouncements: (a: Announcement[]) => void;
}) {
  return (
    <>
      <PanelSection index="01" label="Opening hours">
        {hours.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="v-t-micro w-5 shrink-0 text-center tabular-nums text-v-faint">
              {idx + 1}
            </span>
            <GInput
              value={row.day}
              onChange={(e) =>
                onHours(hours.map((r, i) => (i === idx ? { ...r, day: e.target.value } : r)))
              }
              placeholder="Mon – Fri"
            />
            <GInput
              value={row.hours}
              onChange={(e) =>
                onHours(hours.map((r, i) => (i === idx ? { ...r, hours: e.target.value } : r)))
              }
              placeholder="08:00 – 20:00"
              className="font-v-mono tabular-nums"
            />
            <button
              type="button"
              onClick={() => onHours(hours.filter((_, i) => i !== idx))}
              className="shrink-0 rounded-lg p-1.5 text-v-faint transition-colors hover:bg-red-400/10 hover:text-red-400"
              aria-label="Remove time slot"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onHours([...hours, { day: "", hours: "" }])}
          className="v-t-micro flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2.5 text-v-faint transition-all hover:bg-white/[0.05] hover:text-v-ink"
        >
          <Plus className="h-3.5 w-3.5" />
          Add time slot
        </button>
      </PanelSection>

      <PanelSection index="02" label="Contact & socials">
        <Field label="WhatsApp" hint="Include country code">
          <div className="relative">
            <MessageCircle className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-v-faint" />
            <GInput
              value={socials.whatsapp}
              onChange={(e) => onSocials({ ...socials, whatsapp: e.target.value })}
              placeholder="+995 555 000 000"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Instagram" hint="Handle only, without @">
          <div className="relative">
            <Camera className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-v-faint" />
            <GInput
              value={socials.instagram}
              onChange={(e) => onSocials({ ...socials, instagram: e.target.value })}
              placeholder="yourcafe"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Email">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-v-faint" />
            <GInput
              value={socials.email}
              onChange={(e) => onSocials({ ...socials, email: e.target.value })}
              placeholder="hello@yourcafe.ge"
              className="pl-9"
            />
          </div>
        </Field>
      </PanelSection>

      <PanelSection
        index="03"
        label="Announcements"
        hint={`${announcements.length} / 5`}
      >
        {announcements.map((row, idx) => (
          <div
            key={row.id}
            className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-black/20 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="v-t-micro text-v-faint">
                Announcement {idx + 1}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "v-t-micro",
                    row.isActive ? "text-v-accent" : "text-v-faint",
                  )}
                >
                  {row.isActive ? "Live" : "Off"}
                </span>
                <Toggle
                  checked={row.isActive}
                  onChange={(v) =>
                    onAnnouncements(
                      announcements.map((a) =>
                        a.id === row.id ? { ...a, isActive: v } : a,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    onAnnouncements(announcements.filter((a) => a.id !== row.id))
                  }
                  className="text-v-faint transition-colors hover:text-red-400"
                  aria-label="Delete announcement"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <GTextArea
              value={row.message}
              onChange={(e) =>
                onAnnouncements(
                  announcements.map((a) =>
                    a.id === row.id ? { ...a, message: e.target.value } : a,
                  ),
                )
              }
              rows={2}
              placeholder="e.g. We are closed for renovation this weekend."
            />
          </div>
        ))}
        {announcements.length < 5 && (
          <button
            type="button"
            onClick={() =>
              onAnnouncements([
                { id: crypto.randomUUID(), message: "", isActive: true },
                ...announcements,
              ])
            }
            className="v-t-micro flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2.5 text-v-faint transition-all hover:bg-white/[0.05] hover:text-v-ink"
          >
            <Plus className="h-3.5 w-3.5" />
            Add announcement
          </button>
        )}
      </PanelSection>
    </>
  );
}
