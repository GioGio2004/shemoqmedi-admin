"use client";

import { showError } from "./Alerts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AWARDS,
  CATEGORIES,
  CREATOR_TIERS,
  DAY_MS,
  LIMITS,
  PILLARS,
  REGIONS,
  TECHNOLOGIES,
  VOTING_DAYS,
  type AwardSlug,
  type CategorySlug,
  type CreatorTier,
  type PillarKey,
  type RegionSlug,
  type TechnologyName,
} from "@/convex/lib/taxonomy";
import { MediaPicker, MultiImagePicker, useMediaUpload } from "./MediaUpload";
import { score } from "./format";

type CreateStatus = "pending" | "in_voting" | "awarded" | "archived";
type Phase = "idle" | "uploading" | "saving";
type Pillars = Record<PillarKey, number>;

const STATUS_OPTIONS: { value: CreateStatus; label: string; note: string }[] = [
  { value: "pending", label: "Review queue (pending)", note: "Hidden from the site until you approve it." },
  { value: "in_voting", label: "Live voting", note: "Public now, open for community votes until the end date." },
  { value: "awarded", label: "Awarded", note: "Voting closed, shown with its awards." },
  { value: "archived", label: "Closed (archived)", note: "Voting closed, no award." },
];

/** ms timestamp -> value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) -> ms timestamp, or null. */
function fromLocalInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const EMPTY_PILLARS: Record<PillarKey, string> = { design: "", usability: "", creativity: "", code: "" };

type MediaState = { file: File | null; error: string | null };
const NO_MEDIA: MediaState = { file: null, error: null };

export function ListingCreateForm() {
  const router = useRouter();
  const createListing = useMutation(api.admin.createListing);
  const uploadFile = useMediaUpload();
  // Files already uploaded in this session, so a retry after a failed save
  // does not upload the same screenshot twice.
  const uploaded = useRef(new Map<File, Id<"media">>());
  async function upload(file: File, label: string) {
    const known = uploaded.current.get(file);
    if (known) return known;
    // Folder + file names come from the site title (the slug is derived from it).
    const id = await uploadFile(file, { site: title, label });
    uploaded.current.set(file, id);
    return id;
  }

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [juryNote, setJuryNote] = useState("");
  const [categories, setCategories] = useState<CategorySlug[]>([]);
  const [technologies, setTechnologies] = useState<TechnologyName[]>([]);
  const [creditName, setCreditName] = useState("");
  const [creditUrl, setCreditUrl] = useState("");
  const [tier, setTier] = useState<CreatorTier>("solo");
  const [region, setRegion] = useState<RegionSlug>("georgia");
  const [isClaimed, setIsClaimed] = useState(false);

  const [cover, setCover] = useState<MediaState>(NO_MEDIA);
  const [extras, setExtras] = useState<File[]>([]);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const [video, setVideo] = useState<MediaState>(NO_MEDIA);

  const [status, setStatus] = useState<CreateStatus>("pending");
  const [votingEnds, setVotingEnds] = useState(() => toLocalInput(Date.now() + VOTING_DAYS * DAY_MS));
  const [votingEnded, setVotingEnded] = useState(() => toLocalInput(Date.now()));
  const [awards, setAwards] = useState<AwardSlug[]>([]);

  const [withScores, setWithScores] = useState(false);
  const [pillarDraft, setPillarDraft] = useState(EMPTY_PILLARS);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";
  // Synchronous guard: two submits in the same tick both see busy === false.
  const submitting = useRef(false);

  const parsedPillars = PILLARS.map((p) => ({ key: p.key, raw: pillarDraft[p.key], value: Number(pillarDraft[p.key]) }));
  const pillarsValid = parsedPillars.every(
    (p) => p.raw.trim() !== "" && Number.isFinite(p.value) && p.value >= 1 && p.value <= 10,
  );
  const pillarAverage = pillarsValid ? parsedPillars.reduce((sum, p) => sum + p.value, 0) / PILLARS.length : null;

  function toggleTech(name: TechnologyName) {
    setTechnologies((list) =>
      list.includes(name) ? list.filter((t) => t !== name) : list.length >= LIMITS.technologies ? list : [...list, name],
    );
  }

  function toggleCategory(slug: CategorySlug) {
    setCategories((list) =>
      list.includes(slug) ? list.filter((c) => c !== slug) : list.length >= LIMITS.categories ? list : [...list, slug],
    );
  }

  function toggleAward(slug: AwardSlug) {
    setAwards((list) => (list.includes(slug) ? list.filter((a) => a !== slug) : [...list, slug]));
  }

  /** Returns an error message, or null when the form can be submitted. */
  function validate(): string | null {
    if (!title.trim()) return "Add the site title.";
    if (!url.trim()) return "Add the live URL.";
    if (categories.length === 0) return "Choose at least one category.";
    if (!creditName.trim()) return "Add who made the site.";
    if (!cover.file) return "Add the cover screenshot.";
    const fileError = cover.error ?? video.error;
    if (fileError) return fileError;
    if (status === "in_voting") {
      const ends = fromLocalInput(votingEnds);
      if (ends === null) return "Set when voting ends.";
      if (ends <= Date.now()) return "The voting end date must be in the future.";
    }
    if (status === "awarded" && awards.length === 0) return "Pick at least one award for an awarded site.";
    if ((status === "awarded" || status === "archived") && votingEnded.trim()) {
      const ended = fromLocalInput(votingEnded);
      if (ended === null) return "The voting ended date is not valid.";
      if (ended > Date.now()) return "The voting ended date cannot be in the future.";
    }
    if (withScores && !pillarsValid) return "Each jury score must be between 1.0 and 10.0.";
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || submitting.current) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    submitting.current = true;

    try {
      setPhase("uploading");
      const coverId = await upload(cover.file as File, "cover");
      const galleryIds: Id<"media">[] = [];
      for (const [i, file] of extras.entries()) galleryIds.push(await upload(file, `screenshot-${i + 2}`));
      let videoId: Id<"media"> | undefined;
      if (video.file) videoId = await upload(video.file, "preview");

      let votingEndsAt: number | undefined;
      if (status === "in_voting") votingEndsAt = fromLocalInput(votingEnds) ?? undefined;
      else if (status === "awarded" || status === "archived") votingEndsAt = fromLocalInput(votingEnded) ?? undefined;

      const editorialScores = withScores
        ? (Object.fromEntries(parsedPillars.map((p) => [p.key, p.value])) as Pillars)
        : undefined;

      setPhase("saving");
      const { id } = await createListing({
        title: title.trim(),
        tagline: tagline.trim(),
        juryNote: juryNote.trim() || undefined,
        url: url.trim(),
        categories,
        technologies,
        region,
        creatorTier: tier,
        creditName: creditName.trim(),
        creditUrl: creditUrl.trim() || undefined,
        coverId,
        galleryIds: galleryIds.length ? galleryIds : undefined,
        videoId,
        status,
        votingEndsAt,
        editorialScores,
        awards: status === "awarded" ? awards : undefined,
        isClaimed,
      });
      router.push(`/review/${id}`);
    } catch (err) {
      showError(err);
      setPhase("idle");
      submitting.current = false;
    }
  }

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Add a site</p>
          <h1>New listing.</h1>
          <p>List a site by hand with your own screenshots, in any state of the lifecycle.</p>
        </div>
        <Link href="/review" className="admin-button admin-button-secondary">
          Back to review
        </Link>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={busy} className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
          <legend className="sr-only">New listing</legend>

          {/* Left: fields, lifecycle, scores */}
          <div className="grid min-w-0 gap-6">
            <section className="admin-panel grid gap-6" aria-labelledby="site-heading">
              <p id="site-heading" className="admin-eyebrow">The site</p>

              <label className="grid gap-2">
                <span className="admin-eyebrow">Site title</span>
                <input
                  required
                  maxLength={LIMITS.title}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="admin-input"
                  placeholder="e.g. Studio Nord"
                />
              </label>

              <label className="grid gap-2">
                <span className="admin-eyebrow">Live URL</span>
                <input
                  required
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={LIMITS.url}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="admin-input"
                  placeholder="https://example.com"
                />
              </label>

              <div className="grid gap-2">
                <label htmlFor="tagline" className="admin-eyebrow">
                  Short description (optional)
                </label>
                <textarea
                  id="tagline"
                  rows={3}
                  maxLength={LIMITS.tagline}
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  className="admin-input resize-y"
                  placeholder="One line about the site."
                  aria-describedby="tagline-count"
                />
                <span id="tagline-count" className="admin-mono text-black/55">
                  {tagline.length}/{LIMITS.tagline}
                </span>
              </div>

              <div className="grid gap-2">
                <label htmlFor="jury-note" className="admin-eyebrow">
                  Jury note (optional)
                </label>
                <textarea
                  id="jury-note"
                  rows={4}
                  maxLength={LIMITS.juryNote}
                  value={juryNote}
                  onChange={(e) => setJuryNote(e.target.value)}
                  className="admin-input resize-y"
                  placeholder="A few sentences on what makes this site stand out. Shown on its page."
                  aria-describedby="jury-note-count"
                />
                <span id="jury-note-count" className="admin-mono text-black/55">
                  {juryNote.length}/{LIMITS.juryNote}
                </span>
              </div>

              <fieldset>
                <legend className="admin-eyebrow mb-3">
                  Categories {categories.length}/{LIMITS.categories}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => {
                    const on = categories.includes(c.slug);
                    return (
                      <button
                        key={c.slug}
                        type="button"
                        className="admin-toggle"
                        aria-pressed={on}
                        disabled={!on && categories.length >= LIMITS.categories}
                        onClick={() => toggleCategory(c.slug)}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-black/55">The first one you pick is the main category.</p>
              </fieldset>

              <fieldset>
                <legend className="admin-eyebrow mb-3">
                  Technologies {technologies.length}/{LIMITS.technologies}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {TECHNOLOGIES.map((t) => {
                    const on = technologies.includes(t.name);
                    return (
                      <button
                        key={t.slug}
                        type="button"
                        className="admin-toggle admin-toggle-mono"
                        aria-pressed={on}
                        disabled={!on && technologies.length >= LIMITS.technologies}
                        onClick={() => toggleTech(t.name)}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </section>

            <section className="admin-panel grid gap-6" aria-labelledby="creator-heading">
              <p id="creator-heading" className="admin-eyebrow">The creator</p>

              <div className="grid gap-6 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="admin-eyebrow">Made by</span>
                  <input
                    required
                    maxLength={LIMITS.creditName}
                    value={creditName}
                    onChange={(e) => setCreditName(e.target.value)}
                    className="admin-input"
                    placeholder="Creator or studio name"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="admin-eyebrow">Creator website (optional)</span>
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={LIMITS.url}
                    value={creditUrl}
                    onChange={(e) => setCreditUrl(e.target.value)}
                    className="admin-input"
                    placeholder="https://studio.example"
                  />
                </label>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <fieldset>
                  <legend className="admin-eyebrow mb-3">Creator tier</legend>
                  <div className="flex flex-wrap gap-2">
                    {CREATOR_TIERS.map((t) => (
                      <button
                        key={t.slug}
                        type="button"
                        className="admin-toggle"
                        aria-pressed={tier === t.slug}
                        onClick={() => setTier(t.slug)}
                      >
                        {t.slug === "solo" ? "Solo" : "Agency"}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="admin-eyebrow mb-3">Region</legend>
                  <div className="flex flex-wrap gap-2">
                    {REGIONS.map((r) => (
                      <button
                        key={r.slug}
                        type="button"
                        className="admin-toggle"
                        aria-pressed={region === r.slug}
                        onClick={() => setRegion(r.slug)}
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>

              <label className="admin-check">
                <input type="checkbox" checked={isClaimed} onChange={(e) => setIsClaimed(e.target.checked)} />
                <span>
                  Owner has claimed this site
                  <small>Leave off for sites you list on someone&apos;s behalf.</small>
                </span>
              </label>
            </section>

            <section className="admin-panel grid gap-6" aria-labelledby="lifecycle-heading">
              <p id="lifecycle-heading" className="admin-eyebrow">Lifecycle</p>

              <fieldset>
                <legend className="sr-only">Status</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {STATUS_OPTIONS.map((o) => {
                    const on = status === o.value;
                    return (
                      <label
                        key={o.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${
                          on ? "border-black" : "border-black/10 hover:border-black/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="status"
                          value={o.value}
                          checked={on}
                          onChange={() => setStatus(o.value)}
                          className="mt-1 h-4 w-4 shrink-0 accent-black"
                        />
                        <span className="grid gap-1">
                          <span className="text-sm font-medium">{o.label}</span>
                          <span className="text-xs leading-relaxed text-black/55">{o.note}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {status === "in_voting" && (
                <label className="grid gap-2 md:max-w-xs">
                  <span className="admin-eyebrow">Voting ends</span>
                  <input
                    type="datetime-local"
                    required
                    value={votingEnds}
                    onChange={(e) => setVotingEnds(e.target.value)}
                    className="admin-input admin-mono"
                  />
                  <span className="text-xs text-black/55">Your local time. Defaults to {VOTING_DAYS} days from now.</span>
                </label>
              )}

              {status === "awarded" && (
                <fieldset>
                  <legend className="admin-eyebrow mb-3">Awards (at least one)</legend>
                  <div className="grid gap-3">
                    {AWARDS.map((a) => (
                      <label key={a.slug} className="admin-check">
                        <input
                          type="checkbox"
                          checked={awards.includes(a.slug)}
                          onChange={() => toggleAward(a.slug)}
                        />
                        <span className="flex items-center gap-3">
                          <span className="admin-award">{a.short}</span>
                          {a.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {(status === "awarded" || status === "archived") && (
                <label className="grid gap-2 md:max-w-xs">
                  <span className="admin-eyebrow">Voting ended (optional)</span>
                  <input
                    type="datetime-local"
                    value={votingEnded}
                    onChange={(e) => setVotingEnded(e.target.value)}
                    className="admin-input admin-mono"
                  />
                  <span className="text-xs text-black/55">Your local time. Leave empty for now.</span>
                </label>
              )}
            </section>

            <section className="admin-panel grid gap-6" aria-labelledby="jury-heading">
              <p id="jury-heading" className="admin-eyebrow">Jury score (optional)</p>
              <label className="admin-check">
                <input type="checkbox" checked={withScores} onChange={(e) => setWithScores(e.target.checked)} />
                <span>
                  Add jury scores now
                  <small>Four pillars, 1.0 to 10.0. You can also score later on the review page.</small>
                </span>
              </label>
              {withScores && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {PILLARS.map((p) => (
                      <label key={p.key} className="grid gap-1.5">
                        <span className="admin-eyebrow">{p.name}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={10}
                          step={0.1}
                          value={pillarDraft[p.key]}
                          onChange={(e) => setPillarDraft((d) => ({ ...d, [p.key]: e.target.value }))}
                          className="admin-input admin-mono"
                          placeholder="1.0–10.0"
                        />
                      </label>
                    ))}
                  </div>
                  <p className="flex items-baseline gap-3">
                    <span className="admin-eyebrow">Jury average</span>
                    <span className="admin-mono admin-score">{score(pillarAverage)}</span>
                  </p>
                </>
              )}
            </section>
          </div>

          {/* Right: media */}
          <section className="admin-panel grid min-w-0 gap-8" aria-labelledby="media-heading">
            <p id="media-heading" className="admin-eyebrow">Media</p>
            <div className="grid gap-2">
              <MediaPicker
                id="cover"
                label="Screenshot 1 · cover"
                hint="1920×1080 (16:9), or a full-page screenshot that scrolls in the home slider. PNG/JPG/WebP up to 20 MB, saved as WebP"
                kind="image"
                aspect="16 / 9"
                file={cover.file}
                onChange={(file, err) => setCover({ file, error: err })}
              />
              {cover.error && <p role="alert" className="text-xs font-medium">{cover.error}</p>}
            </div>

            <div className="grid gap-2">
              <MultiImagePicker
                id="extras"
                label="More screenshots (optional)"
                hint={`Up to ${LIMITS.gallery} more, shown after the cover. 16:9 works best. PNG/JPG/WebP up to 20 MB each, saved as WebP`}
                files={extras}
                max={LIMITS.gallery}
                onChange={(files, err) => {
                  setExtras(files);
                  setExtrasError(err);
                }}
              />
              {extrasError && <p role="alert" className="text-xs font-medium">{extrasError}</p>}
            </div>

            <div className="grid gap-2">
              <MediaPicker
                id="video"
                label="Hover video (optional)"
                hint="MP4/WebM ≤ 15 MB"
                kind="video"
                aspect="16 / 9"
                file={video.file}
                onChange={(file, err) => setVideo({ file, error: err })}
              />
              {video.error && <p role="alert" className="text-xs font-medium">{video.error}</p>}
            </div>
          </section>
        </fieldset>

        <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-black/10 pt-8">
          <button type="submit" className="admin-button" disabled={busy}>
            {phase === "uploading" ? "Uploading…" : phase === "saving" ? "Saving…" : "Create listing"}
          </button>
          {busy && <span className="text-xs text-black/55">Keep this tab open.</span>}
          {error && (
            <p role="alert" className="text-sm font-medium">
              {error}
            </p>
          )}
        </div>
      </form>
    </>
  );
}
