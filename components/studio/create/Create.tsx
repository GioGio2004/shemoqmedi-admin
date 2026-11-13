"use client";

import "@/app/studio/screens/create.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showAlert, showError } from "@/components/admin/Alerts";
import { previewFontFaces } from "@/lib/graphics/preview";
import { FORMATS, STYLE_INFO, TEMPLATES, TIERS, type FormatId, type Style, type TemplateId } from "@/lib/graphics/spec";
import { formatDay, storefrontSiteUrl } from "@/lib/storefront";
import { captionedNetworks, captionsFit, captionsForSave, NETWORK_LABEL, type Captions } from "@/lib/studio/captions";
import {
  CAROUSEL_FIELDS,
  DEFAULT_TEMPLATE,
  FEED_FORMATS,
  GLASS,
  OUTPUTS,
  SOURCES,
  formatFor,
  hostOf,
  kindFor,
  needsListing,
  outputAllowed,
  renderArgs,
  renderKey,
  templatesFor,
  type Design,
  type Fields,
  type GlassId,
  type Output,
  type PaletteChoice,
  type Source,
} from "@/lib/studio/create";
import { draftCaptions, storyCaption, type DraftFacts } from "@/lib/studio/drafts";
import { createDraftStore } from "@/lib/studio/persist";
import { formatTbilisi } from "@/lib/studio/time";
import { useAmbient } from "../Ambient";
import { CaptionEditor, StoryNetworks } from "../CaptionEditor";
import { useMedia } from "../hooks";
import { CheckIcon } from "../icons";
import { TimeSheet } from "../TimeSheet";
import { ConfirmSheet, PageHead, Segmented } from "../ui";
import { FinalStep, type Rendered } from "./FinalStep";
import { AwardPicker, ListingPicker, type AwardRow } from "./Pickers";
import { PaletteStrip, PreviewStage, StylePicker, type Look } from "./Stage";
import { ShotPicker, TextField } from "./TextFields";

// Create: one screen, top to bottom. Source → style → output → the live
// preview with every palette beside it and the text → Render final (the
// exact JPEGs from the server) → captions → publish, schedule or keep as a
// draft. Nothing is sent to the server while designing. The work so far is
// kept on this device (lib/studio/persist.ts) until it becomes a post, so
// leaving Create, a reload or iOS discarding the app loses nothing.

/** Fields that come from the chosen listing (a new pick replaces any typed over them). */
const LISTING_KEYS = ["title", "studio", "tagline", "url", "site", "quote", "score"];

type Edits = Partial<Record<TemplateId, Fields>>;

/** Everything chosen, typed and rendered on this page, as kept between visits. */
type CreateDraft = {
  source: Source;
  output: Output;
  template: TemplateId;
  format: FormatId;
  style: Style;
  palette: PaletteChoice;
  glass: GlassId;
  edits: Edits;
  carouselEdits: Fields;
  listingId: Id<"listings"> | null;
  award: AwardRow | null;
  shot: string | null;
  rendered: Rendered | null;
  captions: Captions | null;
  storyCaps: Captions | null;
};

/** One kept draft per way into Create (?output=story starts its own). */
const createDrafts = createDraftStore<CreateDraft>("create");

function freshDraft(output: Output): CreateDraft {
  return {
    source: "listing",
    output,
    template: DEFAULT_TEMPLATE.listing,
    format: "ig_portrait",
    style: "swiss",
    palette: "house",
    glass: "frost",
    edits: {},
    carouselEdits: {},
    listingId: null,
    award: null,
    shot: null,
    rendered: null,
    captions: null,
    storyCaps: null,
  };
}

const FORMAT_LABEL: Partial<Record<FormatId, string>> = { ig_portrait: "Portrait 4:5", square: "Square", link: "Link 1.91:1" };

/** One step: a glass section with its large number; `done` turns the number into a check. */
function Step({ n, title, aside, done, children }: { n: string; title: string; aside?: React.ReactNode; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="st-step st-create-step st-glass" aria-labelledby={`step-${n}`}>
      <div className="st-create-step-head">
        <span className="st-create-n" data-done={done || undefined} aria-hidden="true">
          {n}
          {done && (
            <span className="st-create-n-done">
              <CheckIcon size={12} />
            </span>
          )}
        </span>
        <h2 id={`step-${n}`} className="st-h2">
          {title}
          {done && <span className="sr-only">, done</span>}
        </h2>
        {aside && <span className="st-create-aside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function Create({ initialOutput }: { initialOutput: Output }) {
  const router = useRouter();
  const wide = useMedia("(min-width: 1000px)");

  // Where the last visit left off (the page mounts after the admin gate, so this is read on the client only).
  const [kept] = useState(() => createDrafts.get(initialOutput));
  const [restored, setRestored] = useState(kept !== null);
  const start = { ...freshDraft(initialOutput), ...kept };
  const [source, setSource] = useState<Source>(start.source);
  const [output, setOutput] = useState<Output>(start.output);
  const [template, setTemplate] = useState<TemplateId>(start.template);
  const [format, setFormat] = useState<FormatId>(start.format);
  const [style, setStyle] = useState<Style>(start.style);
  const [palette, setPalette] = useState<PaletteChoice>(start.palette);
  const [glass, setGlass] = useState<GlassId>(start.glass);
  const [edits, setEdits] = useState<Edits>(start.edits);
  const [carouselEdits, setCarouselEdits] = useState<Fields>(start.carouselEdits);
  const [listingId, setListingId] = useState<Id<"listings"> | null>(start.listingId);
  const [award, setAward] = useState<AwardRow | null>(start.award);
  const [shot, setShot] = useState<string | null>(start.shot);
  const [rendered, setRendered] = useState<Rendered | null>(start.rendered);
  const [rendering, setRendering] = useState<number | null>(null);
  const [captions, setCaptions] = useState<Captions | null>(start.captions);
  const [storyCaps, setStoryCaps] = useState<Captions | null>(start.storyCaps);
  const [sheet, setSheet] = useState<"publish" | "schedule" | null>(null);
  const [saving, setSaving] = useState<"now" | "schedule" | "draft" | null>(null);

  // Kept on this device as it changes, until it becomes a post (finish clears it).
  const finished = useRef(false);
  const snapshot = JSON.stringify({ source, output, template, format, style, palette, glass, edits, carouselEdits, listingId, award, shot, rendered, captions, storyCaps } satisfies CreateDraft);
  useEffect(() => {
    if (!finished.current) createDrafts.set(initialOutput, JSON.parse(snapshot) as CreateDraft);
  }, [initialOutput, snapshot]);

  function startOver() {
    const d = freshDraft(initialOutput);
    setSource(d.source);
    setOutput(d.output);
    setTemplate(d.template);
    setFormat(d.format);
    setStyle(d.style);
    setPalette(d.palette);
    setGlass(d.glass);
    setEdits(d.edits);
    setCarouselEdits(d.carouselEdits);
    setListingId(d.listingId);
    setAward(d.award);
    setShot(d.shot);
    setRendered(d.rendered);
    setCaptions(d.captions);
    setStoryCaps(d.storyCaps);
    setRestored(false);
  }

  const detail = useQuery(api.listings.reviewDetail, listingId ? { id: listingId } : "skip");
  const renderForPost = useAction(api.graphics.renderForPost);
  const createPost = useMutation(api.social.create);
  const publishPost = useMutation(api.social.publish);

  // ── What the design is made of ────────────────────────────────────────
  const listing = listingId && detail && detail.id === listingId ? detail : null;
  const shots = useMemo(() => (listing ? [listing.coverUrl, ...listing.galleryUrls].filter((u): u is string => !!u) : []), [listing]);
  const shotUrl = shot ?? shots[0] ?? null;
  const effectiveTemplate: TemplateId = output === "carousel" ? (source === "award" ? "award" : "new_listing") : template;
  const effectiveFormat = formatFor(output, format);

  /** Facts the fields start from: the template's defaults, then the listing's and award's. */
  const baseFields = useMemo(() => {
    const out: Fields = {};
    if (listing) {
      Object.assign(out, {
        title: listing.title,
        studio: listing.creditName,
        tagline: listing.tagline,
        url: hostOf(listing.url),
        site: listing.title,
        ...(listing.juryNote ? { quote: listing.juryNote } : {}),
        ...(listing.finalScore !== null ? { score: listing.finalScore.toFixed(1) } : {}),
      });
    }
    if (award) Object.assign(out, { tier: award.tier in TIERS ? award.tier : "SOTD", date: formatDay(award.date), awardSlug: award.slug });
    return out;
  }, [listing, award]);

  /** The template's fields as shown: typed over the facts, over the template's defaults. */
  const fields = useMemo(() => {
    const spec = TEMPLATES[effectiveTemplate];
    const out: Fields = {};
    for (const f of spec.fields) out[f.key] = edits[effectiveTemplate]?.[f.key] ?? baseFields[f.key] ?? (spec.defaults as Fields)[f.key] ?? "";
    return out;
  }, [effectiveTemplate, edits, baseFields]);
  const carouselFields: Fields = Object.fromEntries(CAROUSEL_FIELDS.map((f) => [f.key, carouselEdits[f.key] ?? (f.key === "quote" ? (listing?.juryNote ?? "") : "")]));

  // A stable object per design, so the palette strip and style cards redraw only when it changes.
  const look: Look = useMemo(
    () => ({ template: effectiveTemplate, format: effectiveFormat, palette, style, glass, fields, shot: shotUrl }),
    [effectiveTemplate, effectiveFormat, palette, style, glass, fields, shotUrl],
  );

  const design: Design = { source, output, template: effectiveTemplate, format: effectiveFormat, style, palette, glass, fields, carouselFields, shot: shotUrl, listingId };
  const key = renderKey(design);
  const stale = !!rendered && rendered.key !== key;
  const carouselBlocked = output === "carousel" && !listingId;

  // ── Captions ──────────────────────────────────────────────────────────
  const facts: DraftFacts = {
    title: fields.title || listing?.title,
    studio: fields.studio || listing?.creditName,
    tagline: fields.tagline || listing?.tagline,
    pageUrl: listing ? storefrontSiteUrl(listing.slug) : undefined,
    tierName: award ? TIERS[award.tier as keyof typeof TIERS] : undefined,
    date: award ? formatDay(award.date) : undefined,
    headline: fields.headline,
    body: fields.body,
    cta: fields.cta,
  };
  const drafts = draftCaptions(source, facts);
  const story = output === "story";
  const label = storyCaption(facts);
  const feedCaptions = captions ?? drafts;
  const storyCaptions = storyCaps ?? { instagram: label, facebook: label };
  const finalCaptions = story ? storyCaptions : feedCaptions;
  const networks = captionedNetworks(finalCaptions);

  // ── Choices ───────────────────────────────────────────────────────────
  function pickSource(next: Source) {
    setSource(next);
    setTemplate(DEFAULT_TEMPLATE[next]);
    if (!outputAllowed(output, next)) setOutput("single");
    if (!needsListing(next)) {
      setListingId(null);
      setAward(null);
      setShot(null);
    }
    if (next !== "award") setAward(null);
    setCaptions(null);
  }

  function pickListing(id: Id<"listings">) {
    setListingId(id);
    setShot(null);
    // The new site's facts replace what was typed over the old one's.
    setEdits((all) =>
      Object.fromEntries(Object.entries(all).map(([t, f]) => [t, Object.fromEntries(Object.entries(f ?? {}).filter(([k]) => !LISTING_KEYS.includes(k)))])) as Edits,
    );
    setCaptions(null);
  }

  function pickAward(a: AwardRow) {
    setAward(a);
    if (a.listing) pickListing(a.listing.id);
    setEdits((all) => ({ ...all, award: Object.fromEntries(Object.entries(all.award ?? {}).filter(([k]) => !["tier", "date", "awardSlug"].includes(k))) }));
  }

  function setField(key: string, value: string) {
    setEdits((all) => ({ ...all, [effectiveTemplate]: { ...all[effectiveTemplate], [key]: value } }));
  }

  // ── Server steps ──────────────────────────────────────────────────────
  async function renderFinal() {
    if (carouselBlocked) return;
    const args = renderArgs(design);
    const startedFor = key;
    setRendering(Date.now());
    try {
      const out = await renderForPost({ ...args, listingId: (args.listingId as Id<"listings"> | undefined) ?? undefined });
      setRendered({ key: startedFor, urls: out.urls, width: out.width, height: out.height });
    } catch (err) {
      showError(err);
    } finally {
      setRendering(null);
    }
  }

  const ready = !!rendered && !stale && rendering === null && networks.length > 0 && captionsFit(finalCaptions);

  async function finish(mode: "now" | "schedule" | "draft", at?: number) {
    if (!rendered) return;
    setSaving(mode);
    let id: Id<"socialPosts"> | null = null;
    try {
      const post = await createPost({
        kind: kindFor(source),
        listingId: listingId ?? undefined,
        facts: { madeIn: "studio", design: { template: effectiveTemplate, format: effectiveFormat, style, palette, output }, text: fields },
        captions: captionsForSave(finalCaptions),
        media: rendered.urls.map((url) => ({ kind: "image" as const, url, role: "graphic" })),
        placement: story ? "story" : "feed",
      });
      id = post.id;
      // It is a post now: the queue holds it, so the kept draft goes.
      finished.current = true;
      createDrafts.set(initialOutput, null);
      if (mode !== "draft") await publishPost({ id, at });
      showAlert(mode === "draft" ? "Saved to the queue." : mode === "now" ? "Publishing." : `Scheduled for ${formatTbilisi(at!)}.`, "success");
      router.push(`/queue?${mode === "schedule" ? "status=scheduled&" : mode === "draft" ? "" : "status=all&"}post=${id}`);
    } catch (err) {
      showError(err);
      // The post was saved even if publishing it was refused: open it in the queue to fix it there.
      if (id) router.push(`/queue?post=${id}`);
      throw err;
    } finally {
      setSaving(null);
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────
  // The background is the work itself: the chosen site's screenshots.
  useAmbient(shotUrl ? [shotUrl, ...shots.filter((u) => u !== shotUrl)] : shots);

  const stageNote = output === "carousel" ? "Cover, drawn here · every slide is laid out in Render final" : undefined;
  const stage = <PreviewStage look={look} sticky={!wide} note={stageNote} />;
  const strip = <PaletteStrip look={look} onPick={setPalette} />;
  const { width: fw, height: fh } = FORMATS[effectiveFormat];
  const fresh = !!rendered && !stale && rendering === null;
  const outputHint = OUTPUTS.find((o) => o.id === output)?.hint;
  const carouselNote = !outputAllowed("carousel", source) ? " · a carousel needs a listing" : "";

  const steps = (
    <>
      <Step n="01" title="Source" aside={SOURCES.find((s) => s.id === source)?.label} done={needsListing(source) ? !!listingId : true}>
        <div className="st-options st-create-options" role="group" aria-label="Source">
          {SOURCES.map((s) => (
            <button key={s.id} type="button" className="st-option" aria-pressed={source === s.id} onClick={() => pickSource(s.id)}>
              {s.label}
              <small>{s.hint}</small>
            </button>
          ))}
        </div>
        {source === "listing" && <ListingPicker value={listingId} onPick={pickListing} />}
        {source === "award" && <AwardPicker value={award?.slug ?? null} onPick={pickAward} />}
      </Step>

      <Step n="02" title="Style" aside={STYLE_INFO[style].label}>
        <StylePicker look={look} onPick={setStyle} />
        <p className="st-note">{STYLE_INFO[style].description}</p>
        {style === "glass" && <Segmented kind="radio" size="sm" label="Glass" value={glass} onChange={setGlass} options={GLASS.map((g) => ({ value: g.id, label: g.label }))} />}
      </Step>

      <Step n="03" title="Output" aside={output === "single" ? FORMAT_LABEL[effectiveFormat] : OUTPUTS.find((o) => o.id === output)?.label}>
        <Segmented
          kind="radio"
          block
          label="Output"
          value={output}
          onChange={setOutput}
          options={OUTPUTS.map((o) => ({ value: o.id, label: o.label, disabled: !outputAllowed(o.id, source) }))}
        />
        <p className="st-note">
          {outputHint}
          {carouselNote}
        </p>
        {output === "single" && (
          <Segmented kind="radio" size="sm" label="Format" value={effectiveFormat} onChange={setFormat} options={FEED_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f] ?? f }))} />
        )}
        {output !== "carousel" && (
          <div className="st-scroll-x st-create-chips" role="group" aria-label="Template">
            {templatesFor(source).map((t) => (
              <button key={t} type="button" className="st-chip st-chip-sm" aria-pressed={template === t} onClick={() => setTemplate(t)}>
                {TEMPLATES[t].label}
              </button>
            ))}
          </div>
        )}
        {story && <p className="st-note">A story is one 9:16 image on Instagram and the Facebook Page.</p>}
      </Step>

      <Step n="04" title={wide ? "Text" : "Design"} aside={wide ? undefined : "Live"}>
        {!wide && (
          <>
            {stage}
            {strip}
          </>
        )}
        {output === "carousel" ? (
          <>
            {carouselBlocked && <p className="st-callout">Pick a listing above: the carousel tells its story from its facts and screenshots.</p>}
            {CAROUSEL_FIELDS.map((f) => (
              <TextField key={f.key} field={f} value={carouselFields[f.key] ?? ""} onChange={(v) => setCarouselEdits((all) => ({ ...all, [f.key]: v }))} />
            ))}
          </>
        ) : (
          <>
            {(TEMPLATES[effectiveTemplate].images as readonly string[]).includes("screenshot") && <ShotPicker shots={shots} value={shotUrl} onPick={setShot} />}
            {TEMPLATES[effectiveTemplate].fields.map((f) => (
              <TextField key={`${effectiveTemplate}-${f.key}`} field={f} value={fields[f.key] ?? ""} onChange={(v) => setField(f.key, v)} />
            ))}
          </>
        )}
      </Step>

      <Step n="05" title="Render final" aside={output === "carousel" ? "All slides" : `${fw}×${fh}`} done={fresh}>
        <p className="st-note">The server draws the exact JPEG{output === "carousel" ? "s" : ""} that will be posted.</p>
        <FinalStep rendered={rendered} stale={stale} rendering={rendering} onRender={renderFinal} slots={output === "carousel" ? 7 : 1} ratio={fw / fh} glass={style === "glass"} />
        {carouselBlocked && <p className="st-note">A carousel needs a listing.</p>}
      </Step>

      <Step
        n="06"
        title={story ? "Where" : "Captions"}
        aside={networks.length ? networks.map((n) => NETWORK_LABEL[n]).join(" · ") : "No network yet"}
        done={networks.length > 0 && captionsFit(finalCaptions)}
      >
        {story ? (
          <StoryNetworks value={storyCaptions} onChange={setStoryCaps} label={label} />
        ) : (
          <>
            <CaptionEditor value={feedCaptions} onChange={setCaptions} drafts={drafts} />
            {captions && (
              <button type="button" className="st-btn st-btn-quiet st-btn-sm st-create-start" onClick={() => setCaptions(null)}>
                Back to the drafts
              </button>
            )}
          </>
        )}
      </Step>

      <Step n="07" title="Publish">
        <p className="st-create-summary" data-ready={ready || undefined} aria-live="polite">
          {!rendered ? (
            "Render the final image first."
          ) : stale ? (
            "Render again: the design changed."
          ) : networks.length === 0 ? (
            "Give at least one network a caption."
          ) : !captionsFit(finalCaptions) ? (
            <span className="st-danger-text">A caption is over its network&apos;s limit.</span>
          ) : (
            <>
              {story ? "A story" : output === "carousel" ? `A carousel of ${rendered.urls.length}` : "One image"} to <strong>{networks.map((n) => NETWORK_LABEL[n]).join(", ")}</strong>.
            </>
          )}
        </p>
        <div className="st-actions st-create-publish">
          <button type="button" className="st-btn" disabled={!ready || saving !== null} data-busy={saving === "now"} onClick={() => setSheet("publish")}>
            Publish now
          </button>
          <button type="button" className="st-btn st-btn-ghost" disabled={!ready || saving !== null} data-busy={saving === "schedule"} onClick={() => setSheet("schedule")}>
            Schedule
          </button>
          <button
            type="button"
            className="st-btn st-btn-quiet st-span"
            disabled={!rendered || stale || rendering !== null || saving !== null}
            data-busy={saving === "draft"}
            onClick={() => finish("draft").catch(() => {})}
          >
            Save as draft
          </button>
        </div>
      </Step>
    </>
  );

  return (
    <>
      <style>{previewFontFaces}</style>
      <PageHead section="Create" title="Create." />
      {restored && (
        <div className="st-create-restored st-glass" role="status">
          <span>Picked up where you left off.</span>
          <button type="button" className="st-btn st-btn-quiet st-btn-sm" onClick={startOver} disabled={saving !== null || rendering !== null}>
            Start over
          </button>
        </div>
      )}
      {wide ? (
        <div className="st-create">
          <div className="st-create-steps">{steps}</div>
          <aside className="st-create-side st-glass" aria-label="Preview">
            {stage}
            {strip}
          </aside>
        </div>
      ) : (
        <div className="st-create st-create-steps">{steps}</div>
      )}
      <ConfirmSheet
        open={sheet === "publish"}
        onClose={() => setSheet(null)}
        title="Publish now?"
        confirmLabel="Publish now"
        body={
          <>
            {story ? "The story" : "The post"} goes out right away to <strong>{networks.map((n) => NETWORK_LABEL[n]).join(", ")}</strong>.
          </>
        }
        onConfirm={() => finish("now")}
      />
      <TimeSheet open={sheet === "schedule"} onClose={() => setSheet(null)} title="Schedule" confirmLabel="Schedule" onPick={(at) => finish("schedule", at)} />
    </>
  );
}
