"use client";

import { useState } from "react";
import { ImageUploader } from "@/components/ImageUploader";
import {
  PanelSection,
  Field,
  Segmented,
  Toggle,
  ColorField,
  OptionTile,
  GInput,
  GTextArea,
  LangSwitch,
  type ContentLang,
} from "../_studio/controls";
import type { I18nRecord } from "./ContentPanels";
import { Sparkles, Trash2 } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE — which consumer menu template renders, plus ONLY that template's
// options. Nothing hidden, nothing irrelevant: switch the template and its
// settings appear in place.
// ─────────────────────────────────────────────────────────────────────────────

export interface LegacyTheme {
  primaryColor: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily: string;
  buttonRadius: string;
  // "studio" = the venue's own published design is live (set by publishing in
  // the Storefront studio). Picking a template here replaces it.
  menuType?: "basic" | "dragable" | "ruled" | "studio";
  categoryLayout?: "pills" | "cards";
}

export interface RuledContent {
  tickerText: I18nRecord;
  storyText: I18nRecord;
  storyImageUrl: string;
  galleryImageUrls: string[];
  accentColor: string;
  menuStyle: "rows" | "gallery";
  showTicker: boolean;
  showTunnel: boolean;
  showFeatured: boolean;
  showStory: boolean;
  showGallery: boolean;
}

const FONT_OPTIONS = ["Inter", "Roboto", "Playfair Display", "DM Sans", "Space Grotesk"];
const RADIUS_OPTIONS = [
  { key: "0px", label: "Sharp" },
  { key: "0.5rem", label: "Rounded" },
  { key: "9999px", label: "Pill" },
];
const MAX_GALLERY = 8;

function TemplateMockup({ kind }: { kind: "ruled" | "basic" | "dragable" }) {
  if (kind === "ruled") {
    return (
      <div className="m-2 flex w-16 flex-col gap-1 border-y border-white/25 px-1 py-1.5">
        <div className="h-1.5 w-10 rounded-[1px] bg-white/60" />
        <div className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 flex-1 rounded-[1px] bg-white/25" />
          ))}
        </div>
        <div className="h-1 w-12 rounded-full bg-white/30" />
      </div>
    );
  }
  if (kind === "basic") {
    return (
      <div className="m-2 flex w-16 flex-col gap-1 py-1">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-2 w-4 rounded-full bg-white/40" />
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="h-3.5 rounded-[2px] bg-white/20" />
        ))}
      </div>
    );
  }
  return (
    <div className="relative m-2 w-16 self-stretch overflow-hidden rounded-[2px] bg-white/10">
      {[[2, 3], [9, 1], [5, 7], [11, 6]].map(([x, y], i) => (
        <div
          key={i}
          className="absolute h-3 w-3 rounded-[1px] bg-white/40"
          style={{ left: x * 4, top: y * 4 }}
        />
      ))}
    </div>
  );
}

const TEMPLATE_LABELS: Record<
  NonNullable<LegacyTheme["menuType"]>,
  { name: string; hint: string }
> = {
  ruled: { name: "Signature", hint: "Cinematic editorial" },
  basic: { name: "Classic", hint: "Vertical scroll" },
  dragable: { name: "Spatial", hint: "Drag-to-explore" },
  studio: { name: "Custom design", hint: "Built by you in the studio" },
};

export function TemplatePanel({
  theme,
  onTheme,
  ruled,
  onRuled,
  cafeName,
  onChangeTemplate,
}: {
  theme: LegacyTheme;
  onTheme: (t: LegacyTheme) => void;
  ruled: RuledContent;
  onRuled: (r: RuledContent) => void;
  cafeName: string;
  /** Opens the picker modal — the ONLY surface that changes menuType. */
  onChangeTemplate: () => void;
}) {
  const [lang, setLang] = useState<ContentLang>("en");
  const menuType = theme.menuType ?? "basic";
  const setTheme = (p: Partial<LegacyTheme>) => onTheme({ ...theme, ...p });
  const setRuled = (p: Partial<RuledContent>) => onRuled({ ...ruled, ...p });
  const current = TEMPLATE_LABELS[menuType];

  return (
    <>
      {/* Which template is live is chosen in the picker modal, not here —
          one writer for menuType means a settings save can never strand a
          published custom design again. */}
      <PanelSection index="01" label="Menu template">
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="pointer-events-none flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-black/30">
            {menuType === "studio" ? (
              <Sparkles className="h-5 w-5 text-v-accent" />
            ) : (
              <TemplateMockup kind={menuType} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium leading-tight text-v-ink">
              {current.name}
            </p>
            <p className="mt-0.5 text-[10px] leading-tight text-v-faint">
              {current.hint}
            </p>
          </div>
          <button
            type="button"
            onClick={onChangeTemplate}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-v-ink transition-colors hover:bg-white/[0.12]"
          >
            Change
          </button>
        </div>
        {menuType === "studio" && (
          <p className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3 text-[11px] leading-relaxed text-v-mut">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
            Your own <strong className="font-semibold text-v-ink">custom design</strong> is
            live. Edit it in the <strong className="font-semibold text-v-ink">Design</strong>{" "}
            section, then press Publish to push changes out.
          </p>
        )}
        {menuType === "ruled" && (
          <p className="flex items-start gap-2 rounded-xl border border-v-accent/25 bg-v-accent/[0.06] p-3 text-[11px] leading-relaxed text-v-mut">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-v-accent" />
            The award-grade template. Its content — ticker, story, gallery — is
            configured below.
          </p>
        )}
      </PanelSection>

      {/* ── Classic-only: category layout ── */}
      {menuType === "basic" && (
        <PanelSection index="02" label="Category layout">
          <div className="grid grid-cols-2 gap-1.5">
            <OptionTile
              active={(theme.categoryLayout ?? "pills") === "pills"}
              label="Pill navigation"
              hint="Horizontal pills, list below"
              onClick={() => setTheme({ categoryLayout: "pills" })}
            />
            <OptionTile
              active={theme.categoryLayout === "cards"}
              label="Visual cards"
              hint="Category grid, popup items"
              onClick={() => setTheme({ categoryLayout: "cards" })}
            />
          </div>
        </PanelSection>
      )}

      {/* ── Classic / Spatial: template colors & type ── */}
      {menuType !== "ruled" && (
        <PanelSection
          index={menuType === "basic" ? "03" : "02"}
          label="Template style"
        >
          <ColorField
            label="Primary"
            value={theme.primaryColor}
            onChange={(v) => setTheme({ primaryColor: v })}
          />
          <ColorField
            label="Background"
            value={theme.backgroundColor ?? ""}
            onChange={(v) => setTheme({ backgroundColor: v })}
            placeholder="#09090b"
          />
          <ColorField
            label="Text"
            value={theme.textColor ?? ""}
            onChange={(v) => setTheme({ textColor: v })}
            placeholder="#ffffff"
          />
          <Field label="Font">
            <Segmented
              size="sm"
              value={theme.fontFamily}
              options={FONT_OPTIONS.map((f) => ({ key: f, label: f.split(" ")[0] }))}
              onChange={(v) => setTheme({ fontFamily: v })}
            />
          </Field>
          <Field label="Button radius">
            <Segmented
              size="sm"
              value={theme.buttonRadius}
              options={RADIUS_OPTIONS}
              onChange={(v) => setTheme({ buttonRadius: v })}
            />
          </Field>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <span className="v-t-micro shrink-0 text-v-faint">Preview</span>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold text-black"
              style={{
                backgroundColor: theme.primaryColor,
                borderRadius: theme.buttonRadius,
                fontFamily: theme.fontFamily,
              }}
            >
              Order Now
            </button>
          </div>
        </PanelSection>
      )}

      {/* ── Signature-only: ruled template content ── */}
      {menuType === "ruled" && (
        <>
          <PanelSection index="02" label="Dish presentation">
            <div className="grid grid-cols-2 gap-1.5">
              <OptionTile
                active={ruled.menuStyle === "gallery"}
                label="Visual wall"
                hint="Masonry of dish cards"
                onClick={() => setRuled({ menuStyle: "gallery" })}
              />
              <OptionTile
                active={ruled.menuStyle === "rows"}
                label="Editorial rows"
                hint="Ruled rows, photo reveal"
                onClick={() => setRuled({ menuStyle: "rows" })}
              />
            </div>
          </PanelSection>

          <PanelSection index="03" label="Ticker & story">
            <div className="-mb-1 flex justify-end">
              <LangSwitch value={lang} onChange={setLang} />
            </div>
            <Field
              label="Marquee ticker"
              hint="Empty auto-fills your venue name"
            >
              <GInput
                value={ruled.tickerText[lang] ?? ""}
                onChange={(e) =>
                  setRuled({ tickerText: { ...ruled.tickerText, [lang]: e.target.value } })
                }
                placeholder="Fresh pastries every morning — Est. 2019"
              />
            </Field>
            <Field label="Story" hint="~300 characters">
              <GTextArea
                rows={3}
                value={ruled.storyText[lang] ?? ""}
                onChange={(e) =>
                  setRuled({ storyText: { ...ruled.storyText, [lang]: e.target.value } })
                }
                placeholder="We started with one espresso machine…"
              />
            </Field>
            <Field label="Story image">
              <div className="flex items-center gap-2">
                <ImageUploader
                  itemName="signature-story"
                  cafeName={cafeName}
                  folder="/menu-gallery"
                  onSuccess={(res: { url?: string }) =>
                    setRuled({ storyImageUrl: res.url || "" })
                  }
                />
                {ruled.storyImageUrl && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ruled.storyImageUrl}
                      alt="Story"
                      className="h-9 w-9 rounded-lg border border-white/10 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setRuled({ storyImageUrl: "" })}
                      className="rounded-lg p-1.5 text-v-faint transition-colors hover:bg-red-400/10 hover:text-red-400"
                      aria-label="Remove story image"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </Field>
          </PanelSection>

          <PanelSection
            index="04"
            label="Gallery wall"
            hint={`${ruled.galleryImageUrls.length}/${MAX_GALLERY}`}
          >
            <div className="grid grid-cols-4 gap-2">
              {ruled.galleryImageUrls.map((url, idx) => (
                <div
                  key={`${url}-${idx}`}
                  className="group relative aspect-[4/5] overflow-hidden rounded-lg border border-white/10 bg-black/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Gallery ${idx + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setRuled({
                        galleryImageUrls: ruled.galleryImageUrls.filter((_, i) => i !== idx),
                      })
                    }
                    className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {ruled.galleryImageUrls.length < MAX_GALLERY && (
                <div className="flex aspect-[4/5] items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-1">
                  <ImageUploader
                    itemName={`signature-gallery-${ruled.galleryImageUrls.length + 1}`}
                    cafeName={cafeName}
                    folder="/menu-gallery"
                    onSuccess={(res: { url?: string }) => {
                      if (res.url)
                        setRuled({
                          galleryImageUrls: [...ruled.galleryImageUrls, res.url],
                        });
                    }}
                  />
                </div>
              )}
            </div>
          </PanelSection>

          <PanelSection index="05" label="Accent & sections">
            <ColorField
              label="Accent color"
              value={ruled.accentColor}
              onChange={(v) => setRuled({ accentColor: v })}
              onClear={() => setRuled({ accentColor: "" })}
              placeholder="#D8FF3A"
            />
            {(
              [
                ["showTicker", "Marquee ticker", "Scrolling strip under the hero"],
                ["showTunnel", "Corridor flythrough", "3D tunnel of your photos"],
                ["showFeatured", "Featured strip", "Starred items carousel"],
                ["showStory", "Story section", "Editorial block with your story"],
                ["showGallery", "Gallery wall", "Drifting parallax images"],
              ] as const
            ).map(([key, label, hint]) => (
              <Field key={key} label={label} hint={hint} inline>
                <Toggle
                  checked={ruled[key]}
                  onChange={(v) => setRuled({ [key]: v })}
                />
              </Field>
            ))}
          </PanelSection>
        </>
      )}
    </>
  );
}
