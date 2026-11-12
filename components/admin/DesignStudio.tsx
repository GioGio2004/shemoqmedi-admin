"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDay } from "@/lib/storefront";
import { PALETTES, type PaletteId } from "@/lib/palettes";
import {
  FORMATS,
  FORMAT_IDS,
  TEMPLATES,
  TEMPLATE_IDS,
  TIERS,
  graphicsQuery,
  type FieldSpec,
  type FormatId,
  type TemplateId,
} from "@/lib/graphics/spec";
import { Select } from "./Select";

// The Design page: social post graphics from templates (app/api/graphics).
// Pick a template, format and palette, fill the text (or take it from a
// listing / award), choose a screenshot, and download the PNG. Claude renders
// the same templates through convex/graphics.ts.

type Fields = Record<string, string>;

const GLASS = [
  { id: "frost", label: "Frost" },
  { id: "liquid", label: "Liquid" },
  { id: "tint", label: "Tint" },
] as const;

/** What Claude writes for a carousel; here typed by hand. */
const STORY_FIELDS = [
  { key: "chip1", label: "Detail 1 chip", placeholder: "The type" },
  { key: "note1", label: "Detail 1 line", placeholder: "A wordmark built like furniture." },
  { key: "chip2", label: "Detail 2 chip", placeholder: "The grid" },
  { key: "note2", label: "Detail 2 line", placeholder: "Every crop is deliberate." },
  { key: "quote", label: "Jury quote", long: true },
  { key: "juror", label: "Juror" },
  { key: "role", label: "Juror role", placeholder: "Creative director" },
  { key: "cta", label: "Last slide headline", placeholder: "See the whole site on Shemoqmedi." },
] as const satisfies readonly FieldSpec[];

type StoryKey = (typeof STORY_FIELDS)[number]["key"];

function initialFields(): Record<TemplateId, Fields> {
  return Object.fromEntries(
    TEMPLATE_IDS.map((t) => [
      t,
      Object.fromEntries(TEMPLATES[t].fields.map((f) => [f.key, (TEMPLATES[t].defaults as Fields)[f.key] ?? ""])),
    ]),
  ) as Record<TemplateId, Fields>;
}

function host(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

/** The value, settled for `ms` (so typing doesn't re-render the PNG on every key). */
function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function FieldInput({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label id={`${id}-label`} htmlFor={id} className="admin-eyebrow">
        {field.label}
      </label>
      {field.options ? (
        <Select
          labelledBy={`${id}-label`}
          value={value}
          onChange={onChange}
          options={field.options.map((o) => ({ value: o, label: o in TIERS ? `${o} · ${TIERS[o as keyof typeof TIERS]}` : o }))}
        />
      ) : field.long ? (
        <textarea
          id={id}
          className="admin-input min-h-24"
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="admin-input"
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function Swatch({ base, surface, accent }: { base: string; surface: string; accent: string }) {
  return (
    <span className="flex h-6 w-16 overflow-hidden rounded-md border border-black/10" aria-hidden="true">
      <span style={{ background: base, flex: 6 }} />
      <span style={{ background: surface, flex: 3 }} />
      <span style={{ background: accent, flex: 1 }} />
    </span>
  );
}

export function DesignStudio() {
  const [template, setTemplate] = useState<TemplateId>("award");
  const [format, setFormat] = useState<FormatId>("ig_portrait");
  const [mode, setMode] = useState<"single" | "carousel">("single");
  const [palette, setPalette] = useState<PaletteId | "auto">("house");
  const [glass, setGlass] = useState<(typeof GLASS)[number]["id"]>("frost");
  const [story, setStory] = useState<Record<StoryKey, string>>(
    () => Object.fromEntries(STORY_FIELDS.map((f) => [f.key, ""])) as Record<StoryKey, string>,
  );
  const [slides, setSlides] = useState<string[]>([]);
  const [fields, setFields] = useState(initialFields);
  const [listingId, setListingId] = useState<Id<"listings"> | null>(null);
  const [screenshot, setScreenshot] = useState("");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const listings = useQuery(api.admin.featuredOptions, {});
  const detail = useQuery(api.listings.reviewDetail, listingId ? { id: listingId } : "skip");
  const awards = useQuery(api.awards.overview, template === "award" || mode === "carousel" ? {} : "skip");

  const spec = TEMPLATES[template];
  const current = fields[template];
  const setField = (key: string, value: string) =>
    setFields((all) => ({ ...all, [template]: { ...all[template], [key]: value } }));

  // Choosing a listing fills the fields every template shares, and the screenshot.
  useEffect(() => {
    if (!detail) return;
    const fromListing: Fields = {
      title: detail.title,
      studio: detail.creditName,
      tagline: detail.tagline,
      url: host(detail.url),
      site: detail.title,
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the form to the loaded listing once
    setFields((all) =>
      Object.fromEntries(
        TEMPLATE_IDS.map((t) => [
          t,
          {
            ...all[t],
            ...Object.fromEntries(
              TEMPLATES[t].fields.filter((f) => f.key in fromListing).map((f) => [f.key, fromListing[f.key]]),
            ),
          },
        ]),
      ) as Record<TemplateId, Fields>,
    );
    setScreenshot(detail.coverUrl ?? "");
  }, [detail]);

  function pickAward(slug: string) {
    const award = awards?.recent.find((a) => a.slug === slug);
    if (!award) return;
    setFields((all) => ({
      ...all,
      award: {
        ...all.award,
        tier: award.tier in TIERS ? award.tier : all.award.tier,
        date: formatDay(award.date),
        awardSlug: award.slug,
      },
    }));
    if (award.listing) setListingId(award.listing.id);
  }

  const shots = useMemo(() => {
    if (!detail) return [];
    return [detail.coverUrl, ...detail.galleryUrls].filter((u): u is string => !!u);
  }, [detail]);

  const singleQuery = graphicsQuery({
    template,
    format,
    palette,
    fields: { ...current, glass },
    images: spec.images.includes("screenshot" as never) ? { screenshot } : {},
  });

  // The carousel tells the chosen site's story: its facts, every screenshot, the award picked above.
  const carouselQuery = useMemo(() => {
    const q = new URLSearchParams({ palette, glass });
    const put = (k: string, v: string | number | null | undefined) => {
      if (v !== null && v !== undefined && String(v).trim()) q.set(k, String(v).trim());
    };
    if (detail) {
      put("title", detail.title);
      put("studio", detail.creditName);
      put("url", detail.url);
      put("tagline", detail.tagline);
      put("slug", detail.slug);
      put("tech", detail.technologies.join(","));
      put("categories", detail.categoryNames.join(","));
      put("score", detail.finalScore);
      if (detail.editorialScores) for (const [k, v] of Object.entries(detail.editorialScores)) put(k, v);
      for (const shot of shots.slice(0, 4)) q.append("shot", shot);
    }
    const award = fields.award;
    if (award.awardSlug) {
      put("tier", award.tier);
      put("date", award.date);
      put("awardSlug", award.awardSlug);
    }
    put("quote", story.quote);
    put("juror", story.juror);
    put("role", story.role);
    put("cta", story.cta);
    for (const chip of [story.chip1, story.chip2].filter((c) => c.trim())) q.append("chip", chip.trim());
    for (const note of [story.note1, story.note2].filter((c) => c.trim())) q.append("note", note.trim());
    return q.toString();
  }, [detail, shots, fields.award, story, palette, glass]);

  const settledSingle = useDebounced(singleQuery, 400);
  const settledCarousel = useDebounced(carouselQuery, 600);
  const carousel = mode === "carousel";
  const src = carousel
    ? `/api/graphics/carousel?${settledCarousel}&slide=strip&scale=0.3&output=jpeg`
    : `/api/graphics?${settledSingle}`;

  // How many slides the story has (6–8), for the download links.
  useEffect(() => {
    if (!carousel || !detail) return;
    let live = true;
    fetch(`/api/graphics/carousel?${settledCarousel}&slide=plan`)
      .then((r) => (r.ok ? r.json() : { slides: [] }))
      .then((j: { slides: string[] }) => {
        if (live) setSlides(j.slides);
      })
      .catch(() => {
        if (live) setSlides([]);
      });
    return () => {
      live = false;
    };
  }, [carousel, detail, settledCarousel]);

  const { width, height } = carousel ? { width: 1080 * Math.max(1, slides.length || 7), height: 1350 } : FORMATS[format];
  const fileName = carousel ? "shemoqmedi-carousel-strip.jpg" : `shemoqmedi-${template}-${format}-${palette}.jpg`.replace(/_/g, "-");

  const q = search.trim().toLowerCase();
  const matches = (listings ?? [])
    .filter((l) => !q || `${l.title} ${l.creditName} ${l.slug}`.toLowerCase().includes(q))
    .slice(0, 8);

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Social</p>
          <h1>Design.</h1>
          <p>
            Post graphics from templates, in the formats Instagram, LinkedIn and Facebook want. Colours follow the
            palette&apos;s 60 / 30 / 10 split. Claude renders the same templates when it prepares a post.
          </p>
        </div>
        <a href={src} download={fileName} className="admin-button">
          {carousel ? "Download strip" : "Download JPEG"}
        </a>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="grid gap-6">
          <section className="admin-panel grid gap-5" aria-labelledby="design-layout">
            <h2 id="design-layout" className="text-2xl font-semibold">
              Layout
            </h2>
            <div className="grid gap-2">
              <p className="admin-eyebrow">Template</p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_IDS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={!carousel && t === template ? "admin-button" : "admin-button admin-button-secondary"}
                    aria-pressed={!carousel && t === template}
                    onClick={() => {
                      setMode("single");
                      setTemplate(t);
                    }}
                  >
                    {TEMPLATES[t].label}
                  </button>
                ))}
                <button
                  type="button"
                  className={carousel ? "admin-button" : "admin-button admin-button-secondary"}
                  aria-pressed={carousel}
                  onClick={() => setMode("carousel")}
                >
                  Carousel story
                </button>
              </div>
            </div>
            <div className="grid gap-2" hidden={carousel}>
              <p className="admin-eyebrow">Format</p>
              <div className="flex flex-wrap gap-2">
                {FORMAT_IDS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={f === format ? "admin-button" : "admin-button admin-button-secondary"}
                    aria-pressed={f === format}
                    onClick={() => setFormat(f)}
                  >
                    {FORMATS[f].label}
                    <span className="admin-mono opacity-60">
                      {FORMATS[f].width}×{FORMATS[f].height}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <p className="admin-eyebrow">Palette</p>
              <div className="flex flex-wrap gap-2">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={p.id === palette ? "admin-button" : "admin-button admin-button-secondary"}
                    aria-pressed={p.id === palette}
                    onClick={() => setPalette(p.id)}
                  >
                    <Swatch {...p} />
                    {p.name}
                  </button>
                ))}
                <button
                  type="button"
                  className={palette === "auto" ? "admin-button" : "admin-button admin-button-secondary"}
                  aria-pressed={palette === "auto"}
                  onClick={() => setPalette("auto")}
                  title="Tinted from the site's own colours"
                >
                  Auto
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <p className="admin-eyebrow">Glass</p>
              <div className="flex flex-wrap gap-2">
                {GLASS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={g.id === glass ? "admin-button" : "admin-button admin-button-secondary"}
                    aria-pressed={g.id === glass}
                    onClick={() => setGlass(g.id)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="admin-panel grid gap-5" aria-labelledby="design-source">
            <h2 id="design-source" className="text-2xl font-semibold">
              From a site
            </h2>
            {(template === "award" || carousel) && (
              <AwardPicker
                awards={awards?.recent.filter((a) => a.status === "active") ?? null}
                value={current.awardSlug ?? ""}
                onPick={pickAward}
              />
            )}
            <input
              type="search"
              className="admin-input"
              placeholder="Search live sites"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search live sites"
            />
            {listings === undefined ? (
              <p className="admin-eyebrow">Loading…</p>
            ) : (
              <ul className="grid gap-2">
                {matches.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setListingId(l.id)}
                      aria-pressed={l.id === listingId}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-2 pr-3 text-left ${
                        l.id === listingId ? "border-black" : "border-black/10 hover:border-black/40"
                      }`}
                    >
                      {l.coverUrl ? (
                        <img src={l.coverUrl} alt="" className="aspect-video w-20 shrink-0 rounded-lg object-cover object-top" />
                      ) : (
                        <span className="aspect-video w-20 shrink-0 rounded-lg border border-dashed border-black/20" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{l.title}</span>
                        <span className="block truncate text-xs text-black/55">{l.creditName}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <p className="text-sm text-black/55">No live site matches.</p>}
              </ul>
            )}

            {!carousel && spec.images.includes("screenshot" as never) && (
              <div className="grid gap-3 border-t border-black/10 pt-5">
                <p className="admin-eyebrow">Screenshot</p>
                {shots.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {shots.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setScreenshot(url)}
                        aria-pressed={url === screenshot}
                        aria-label="Use this screenshot"
                        className={`overflow-hidden rounded-lg border-2 ${
                          url === screenshot ? "border-black" : "border-transparent hover:border-black/30"
                        }`}
                      >
                        <img src={url} alt="" className="aspect-video w-28 object-cover object-top" />
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="admin-input"
                  placeholder="Or paste an image URL (ImageKit, R2)"
                  value={screenshot}
                  onChange={(e) => setScreenshot(e.target.value)}
                  aria-label="Screenshot URL"
                />
              </div>
            )}
          </section>

          <section className="admin-panel grid gap-5" aria-labelledby="design-text">
            <h2 id="design-text" className="text-2xl font-semibold">
              Text
            </h2>
            {carousel ? (
              <>
                {!detail && (
                  <p className="text-sm text-black/55">Pick a site above: the story is told from its facts and screenshots.</p>
                )}
                {STORY_FIELDS.map((f) => (
                  <FieldInput
                    key={`story-${f.key}`}
                    field={f}
                    value={story[f.key]}
                    onChange={(v) => setStory((all) => ({ ...all, [f.key]: v }))}
                  />
                ))}
              </>
            ) : (
              spec.fields.map((f) => (
                <FieldInput key={`${template}-${f.key}`} field={f} value={current[f.key] ?? ""} onChange={(v) => setField(f.key, v)} />
              ))
            )}
          </section>
        </div>

        <section className="admin-panel grid gap-4 lg:sticky lg:top-6" aria-labelledby="design-preview">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="design-preview" className="text-2xl font-semibold">
              Preview
            </h2>
            <p className="admin-mono">
              {width}×{height}
              {loaded !== src && failed !== src ? " · rendering…" : ""}
            </p>
          </div>
          <div
            className="relative mx-auto w-full overflow-hidden rounded-xl border border-black/10 bg-black/[0.03]"
            style={{ aspectRatio: `${width} / ${height}`, maxHeight: "78vh", maxWidth: `calc(78vh * ${width / height})` }}
          >
            <img
              key={src}
              src={src}
              alt={`${TEMPLATES[template].label} graphic preview`}
              className="absolute inset-0 h-full w-full"
              onLoad={() => setLoaded(src)}
              onError={() => setFailed(src)}
            />
          </div>
          {failed === src && <p className="text-sm">The preview did not render. Check the fields and the image URL.</p>}
          {carousel && detail && slides.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="admin-eyebrow mr-2">Slides</span>
              {slides.map((kind, i) => (
                <a
                  key={`${i}-${kind}`}
                  className="admin-button admin-button-secondary"
                  href={`/api/graphics/carousel?${settledCarousel}&slide=${i}`}
                  download={`shemoqmedi-${detail.slug}-${String(i + 1).padStart(2, "0")}-${kind}.jpg`}
                >
                  {i + 1} · {kind}
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function AwardPicker({
  awards,
  value,
  onPick,
}: {
  awards: { slug: string; tier: string; date: string; listing: { title: string } | null }[] | null;
  value: string;
  onPick: (slug: string) => void;
}) {
  const id = useId();
  if (awards === null) return <p className="admin-eyebrow">Loading awards…</p>;
  if (awards.length === 0) return <p className="text-sm text-black/55">No awards yet. Fill the fields by hand.</p>;
  return (
    <div className="grid gap-2">
      <p id={id} className="admin-eyebrow">
        Award
      </p>
      <Select
        labelledBy={id}
        value={value}
        onChange={onPick}
        placeholder="Pick an award to fill the fields"
        options={awards.map((a) => ({
          value: a.slug,
          label: `${a.tier} · ${a.listing?.title ?? "Removed site"} · ${formatDay(a.date)}`,
        }))}
      />
    </div>
  );
}
