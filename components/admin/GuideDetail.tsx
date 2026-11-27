"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { formatDate } from "@/lib/storefront";
import { placeholders } from "@/lib/guideText";
import { CopyButton } from "@/components/guides/CopyButton";
import { GuideText } from "@/components/guides/GuideText";
import { MAX_IMAGE_INPUT_BYTES, uploadToImageKit } from "@/lib/imagekitUpload";
import { showAlert, showError } from "./Alerts";
import { Select } from "./Select";
import { RolePicker } from "./Guides";
import { GUIDE_AREAS, areaLabel, roleLabel, type GuideArea, type GuideRole } from "./guideLabels";

type Guide = NonNullable<FunctionReturnType<typeof api.guides.get>>;
type Section = Guide["sections"][number];

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGES = 8;

// ─── Reading ────────────────────────────────────────────────────────────────

function Text({ text }: { text: string }) {
  if (!text.trim()) return <p className="opacity-50">No text yet.</p>;
  return <GuideText text={text} className="guide-text" />;
}

function Images({ images }: { images: Section["images"] }) {
  if (!images.length) return null;
  return (
    <div className="guide-images">
      {images.map((img) => (
        <figure key={img.mediaId}>
          {img.url ? (
            <a href={img.url} target="_blank" rel="noopener noreferrer" aria-label={`Open screenshot${img.caption ? `: ${img.caption}` : ""} full size`}>
              <img src={img.url} alt={img.caption ?? ""} loading="lazy" />
            </a>
          ) : (
            <div className="guide-image-missing">Screenshot unavailable</div>
          )}
          {img.caption && <figcaption>{img.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function SectionView({ section }: { section: Section }) {
  const blanks = section.kind === "template" ? placeholders(section.body) : [];
  return (
    <div className="grid gap-4">
      {section.kind === "template" ? (
        <>
          <div className="guide-message">{section.body || <span className="opacity-50">No message yet.</span>}</div>
          <div className="flex flex-wrap items-center gap-3">
            {section.body && <CopyButton text={section.body} className="admin-button" />}
            {blanks.length > 0 && <span className="text-xs opacity-60">Fill in before sending: {blanks.map((b) => `{${b}}`).join(", ")}</span>}
          </div>
        </>
      ) : (
        <Text text={section.body} />
      )}
      <Images images={section.images} />
    </div>
  );
}

// ─── Editing ────────────────────────────────────────────────────────────────

type DraftImage = { key: string; mediaId?: Id<"media">; url: string | null; caption: string; file?: File };

function SectionEditor({ guide, section, onDone }: { guide: Guide; section: Section; onDone: () => void }) {
  const save = useMutation(api.guides.updateSection);
  const getAuth = useAction(api.media.guideUploadAuth);
  const register = useMutation(api.media.registerGuide);
  const [kind, setKind] = useState(section.kind);
  const [language, setLanguage] = useState<"ka" | "en" | "">(section.language ?? "");
  const [heading, setHeading] = useState(section.heading);
  const [body, setBody] = useState(section.body);
  const [images, setImages] = useState<DraftImage[]>(() =>
    section.images.map((i) => ({ key: i.mediaId, mediaId: i.mediaId, url: i.url, caption: i.caption ?? "" })),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const id = useId();

  // Local previews of picked files are released when the editor closes (and when removed, below).
  const latest = useRef(images);
  useEffect(() => {
    latest.current = images;
  }, [images]);
  useEffect(() => () => latest.current.forEach((i) => i.file && i.url && URL.revokeObjectURL(i.url)), []);

  const pick = (files: FileList | null) => {
    if (!files) return;
    const next: DraftImage[] = [];
    for (const file of Array.from(files)) {
      if (!IMAGE_TYPES.includes(file.type)) {
        showAlert(`${file.name}: screenshots must be PNG, JPG or WebP.`);
        continue;
      }
      if (file.size > MAX_IMAGE_INPUT_BYTES) {
        showAlert(`${file.name}: screenshots must be 20 MB or less.`);
        continue;
      }
      next.push({ key: `${file.name}-${file.size}-${Math.random()}`, url: URL.createObjectURL(file), caption: "", file });
    }
    setImages((list) => {
      const room = MAX_IMAGES - list.length;
      if (next.length > room) showAlert(`A section can have up to ${MAX_IMAGES} screenshots.`);
      next.slice(Math.max(room, 0)).forEach((i) => i.url && URL.revokeObjectURL(i.url));
      return [...list, ...next.slice(0, Math.max(room, 0))];
    });
  };

  const moveImage = (i: number, by: -1 | 1) =>
    setImages((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const out: { mediaId: Id<"media">; caption?: string }[] = [];
      for (const [n, img] of images.entries()) {
        let mediaId = img.mediaId;
        if (!mediaId && img.file) {
          setBusy(`Uploading screenshot ${n + 1} of ${images.length}…`);
          const args = await uploadToImageKit(img.file, { site: guide.slug, label: `${heading}-${n + 1}` }, (a) => getAuth(a));
          mediaId = await register({ ...args, kind: "image" });
        }
        if (mediaId) out.push({ mediaId, caption: img.caption.trim() || undefined });
      }
      setBusy("Saving…");
      await save({
        sectionId: section.id,
        kind,
        heading,
        body,
        language: kind === "template" && language ? language : undefined,
        images: out,
      });
      onDone();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <span id={`${id}-kind`} className="admin-eyebrow">
            Kind
          </span>
          <Select
            value={kind}
            onChange={(v) => setKind(v as Section["kind"])}
            options={[
              { value: "steps", label: "Text and steps" },
              { value: "template", label: "Message to copy" },
            ]}
            labelledBy={`${id}-kind`}
          />
        </div>
        {kind === "template" && (
          <div className="grid gap-2">
            <span id={`${id}-lang`} className="admin-eyebrow">
              Language
            </span>
            <Select
              value={language}
              onChange={(v) => setLanguage(v as "ka" | "en" | "")}
              options={[
                { value: "", label: "Not set" },
                { value: "en", label: "English" },
                { value: "ka", label: "Georgian" },
              ]}
              labelledBy={`${id}-lang`}
            />
          </div>
        )}
      </div>
      <label className="grid gap-2">
        <span className="admin-eyebrow">Heading</span>
        <input className="admin-input" value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={140} required />
      </label>
      <label className="grid gap-2">
        <span className="admin-eyebrow">{kind === "template" ? "Message (copied exactly as written)" : "Text"}</span>
        <textarea
          className="admin-input guide-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.min(24, Math.max(6, body.split("\n").length + 2))}
          maxLength={10000}
        />
        <span className="text-xs opacity-60">
          {kind === "template"
            ? "Put what the sender fills in between {curly brackets}."
            : "A blank line starts a paragraph. Start a line with “- ” for a bullet or “1. ” for a numbered step. Links work as typed."}
        </span>
      </label>

      <div className="grid gap-3">
        <p className="admin-eyebrow">Screenshots ({images.length}/{MAX_IMAGES})</p>
        {images.length > 0 && (
          <ul className="grid gap-3">
            {images.map((img, i) => (
              <li key={img.key} className="guide-image-edit">
                {img.url ? (
                  <img src={img.url} alt="" />
                ) : (
                  <div className="guide-image-missing">Unavailable</div>
                )}
                <div className="grid min-w-0 gap-2">
                  <input
                    className="admin-input"
                    value={img.caption}
                    maxLength={200}
                    placeholder="Caption: what to click here (optional)"
                    aria-label={`Caption for screenshot ${i + 1}`}
                    onChange={(e) => setImages((list) => list.map((x) => (x.key === img.key ? { ...x, caption: e.target.value } : x)))}
                  />
                  <div className="flex flex-wrap gap-2">
                    {img.file && <span className="admin-tag">Uploads on save</span>}
                    <button type="button" className="admin-toggle" disabled={i === 0} onClick={() => moveImage(i, -1)} aria-label={`Move screenshot ${i + 1} up`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="admin-toggle"
                      disabled={i === images.length - 1}
                      onClick={() => moveImage(i, 1)}
                      aria-label={`Move screenshot ${i + 1} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="admin-toggle"
                      onClick={() => {
                        if (img.file && img.url) URL.revokeObjectURL(img.url);
                        setImages((list) => list.filter((x) => x.key !== img.key));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {images.length < MAX_IMAGES && (
          <label className="guide-drop">
            <input type="file" accept={IMAGE_TYPES.join(",")} multiple className="sr-only" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
            <span>Add screenshots</span>
            <span className="text-xs opacity-60">PNG, JPG or WebP. Saved as WebP on ImageKit when you press Save.</span>
          </label>
        )}
        {images.some((i) => i.mediaId) && (
          <p className="text-xs opacity-60">Screenshots you remove are deleted from ImageKit when you save.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="admin-button" disabled={!!busy || !heading.trim()}>
          {busy ?? "Save section"}
        </button>
        <button type="button" className="admin-button admin-button-secondary" disabled={!!busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MetaEditor({ guide, onDone }: { guide: Guide; onDone: () => void }) {
  const update = useMutation(api.guides.update);
  const remove = useMutation(api.guides.remove);
  const router = useRouter();
  const [title, setTitle] = useState(guide.title);
  const [summary, setSummary] = useState(guide.summary ?? "");
  const [area, setArea] = useState<GuideArea>(guide.area);
  const [roles, setRoles] = useState<GuideRole[]>(guide.roles);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roles.length) return showAlert("Pick who the guide is for.");
    setBusy(true);
    try {
      await update({ guideId: guide.id, title, summary, area, roles });
      onDone();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="admin-panel grid gap-5" aria-label="Guide details">
      <label className="grid gap-2">
        <span className="admin-eyebrow">Title</span>
        <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
      </label>
      <label className="grid gap-2">
        <span className="admin-eyebrow">When to use it</span>
        <input className="admin-input" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={280} />
      </label>
      <div className="grid gap-5 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="grid gap-2">
          <span id={`${id}-area`} className="admin-eyebrow">
            Area
          </span>
          <Select value={area} onChange={(v) => setArea(v as GuideArea)} options={GUIDE_AREAS} labelledBy={`${id}-area`} />
        </div>
        <div className="grid gap-2">
          <span id={`${id}-roles`} className="admin-eyebrow">
            For
          </span>
          <RolePicker value={roles} onChange={setRoles} labelledBy={`${id}-roles`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="admin-button" disabled={busy || !title.trim()}>
            {busy ? "Saving…" : "Save details"}
          </button>
          <button type="button" className="admin-button admin-button-secondary" onClick={onDone}>
            Cancel
          </button>
        </div>
        <button
          type="button"
          className="admin-text-link"
          onClick={async () => {
            if (!confirm(`Delete “${guide.title}” with all its sections and screenshots? This can't be undone.`)) return;
            try {
              await remove({ guideId: guide.id });
              router.push("/guides");
            } catch (err) {
              showError(err);
            }
          }}
        >
          Delete guide
        </button>
      </div>
    </form>
  );
}

function SectionBlock({ guide, section, index, editing }: { guide: Guide; section: Section; index: number; editing: boolean }) {
  const move = useMutation(api.guides.moveSection);
  const remove = useMutation(api.guides.removeSection);
  const [open, setOpen] = useState(false);
  const last = index === guide.sections.length - 1;
  const run = (fn: () => Promise<unknown>) => fn().catch(showError);
  const anchor = `section-${index + 1}`;

  return (
    <section id={anchor} className="guide-section" aria-labelledby={`${anchor}-h`}>
      <header className="guide-section-head">
        <div className="grid min-w-0 gap-1">
          <p className="admin-eyebrow">
            {section.kind === "template" ? "Message" : "Section"}
            {section.language && ` · ${section.language === "ka" ? "Georgian" : "English"}`}
          </p>
          <h2 id={`${anchor}-h`}>{section.heading}</h2>
        </div>
        {editing && !open && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="admin-toggle" disabled={index === 0} onClick={() => run(() => move({ sectionId: section.id, direction: "up" }))} aria-label={`Move “${section.heading}” up`}>
              ↑
            </button>
            <button type="button" className="admin-toggle" disabled={last} onClick={() => run(() => move({ sectionId: section.id, direction: "down" }))} aria-label={`Move “${section.heading}” down`}>
              ↓
            </button>
            <button type="button" className="admin-toggle" onClick={() => setOpen(true)}>
              Edit
            </button>
            <button
              type="button"
              className="admin-toggle"
              onClick={() => {
                if (confirm(`Delete the section “${section.heading}”${section.images.length ? " and its screenshots" : ""}?`)) run(() => remove({ sectionId: section.id }));
              }}
            >
              Delete
            </button>
          </div>
        )}
      </header>
      {editing && open ? <SectionEditor guide={guide} section={section} onDone={() => setOpen(false)} /> : <SectionView section={section} />}
    </section>
  );
}

/** One guide: read it, or (Edit) change its details and sections, add screenshots and reorder. */
export function GuideDetail({ slug, startEditing }: { slug: string; startEditing: boolean }) {
  const guide = useQuery(api.guides.get, { slug });
  const addSection = useMutation(api.guides.addSection);
  const setStatus = useMutation(api.guides.update);
  const [editing, setEditing] = useState(startEditing);
  const [meta, setMeta] = useState(false);

  if (guide === undefined) return <p className="admin-eyebrow">Loading…</p>;
  if (guide === null)
    return (
      <div className="admin-empty">
        <h2>No such guide.</h2>
        It may have been deleted. <Link href="/guides" className="underline underline-offset-4">All guides</Link>
      </div>
    );

  const add = (kind: "steps" | "template") =>
    addSection({ guideId: guide.id, kind })
      .then(() => setTimeout(() => document.getElementById(`section-${guide.sections.length + 1}`)?.scrollIntoView({ behavior: "smooth" }), 150))
      .catch(showError);

  return (
    <>
      <div className="admin-page-heading">
        <div className="min-w-0">
          <p className="admin-eyebrow">
            <Link href="/guides" className="underline-offset-4 hover:underline">
              Guides
            </Link>{" "}
            · {areaLabel(guide.area)}
          </p>
          <h1>{guide.title}</h1>
          {guide.summary && <p>{guide.summary}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {guide.roles.map((r) => (
              <span key={r} className="admin-tag">
                For: {roleLabel(r)}
              </span>
            ))}
            {guide.status === "draft" && <span className="admin-tag">Draft</span>}
            <span className="admin-mono opacity-60">
              Updated {formatDate(guide.updatedAt)}
              {guide.updatedByName ? ` by ${guide.updatedByName}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {editing && (
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={() => setStatus({ guideId: guide.id, status: guide.status === "draft" ? "ready" : "draft" }).catch(showError)}
            >
              {guide.status === "draft" ? "Mark ready" : "Back to draft"}
            </button>
          )}
          {!editing && (
            <Link href={`/tasks?guide=${encodeURIComponent(guide.slug)}`} className="admin-button admin-button-secondary">
              Make a task from it
            </Link>
          )}
          <button type="button" className={editing ? "admin-button" : "admin-button admin-button-secondary"} onClick={() => (setEditing(!editing), setMeta(false))}>
            {editing ? "Done editing" : "Edit guide"}
          </button>
        </div>
      </div>

      <div className="guide-layout">
        {guide.sections.length > 1 && (
          <nav className="guide-toc" aria-label="In this guide">
            <p className="admin-eyebrow">In this guide</p>
            <ol>
              {guide.sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#section-${i + 1}`}>{s.heading}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="grid min-w-0 gap-6">
          {editing &&
            (meta ? (
              <MetaEditor guide={guide} onDone={() => setMeta(false)} />
            ) : (
              <div>
                <button type="button" className="admin-text-link" onClick={() => setMeta(true)}>
                  Edit title, area and who it&apos;s for
                </button>
              </div>
            ))}
          {guide.sections.length === 0 && (
            <div className="admin-empty">{editing ? "No sections yet. Add the first one below." : "This guide has no sections yet. Press Edit guide to add them."}</div>
          )}
          {guide.sections.map((s, i) => (
            <SectionBlock key={s.id} guide={guide} section={s} index={i} editing={editing} />
          ))}
          {editing && (
            <div className="flex flex-wrap gap-3">
              <button type="button" className="admin-button" onClick={() => add("steps")}>
                Add section
              </button>
              <button type="button" className="admin-button admin-button-secondary" onClick={() => add("template")}>
                Add message to copy
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
