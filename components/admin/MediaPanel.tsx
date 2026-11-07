"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/taxonomy";
import { MediaPicker, MultiImagePicker, useStorageUpload, type UploadKind } from "./MediaUpload";
import { errorMessage } from "./format";

type Listing = NonNullable<FunctionReturnType<typeof api.listings.reviewDetail>>;
type Kind = "cover" | "video";

type Slot = {
  kind: Kind;
  label: string;
  media: UploadKind;
  aspect: string;
  hint: string;
  removable: boolean;
};

const SLOTS: Record<Kind, Slot> = {
  cover: {
    kind: "cover",
    label: "Screenshot 1 · cover",
    media: "image",
    aspect: "16 / 9",
    hint: "1920×1080, or a full-page screenshot (it scrolls in the home slider). PNG, JPG or WebP, up to 5 MB. Required.",
    removable: false,
  },
  video: {
    kind: "video",
    label: "Preview video",
    media: "video",
    aspect: "16 / 9",
    hint: "MP4 or WebM, up to 10 MB. Plays on hover.",
    removable: true,
  },
};

function MediaSlot({
  listingId,
  slot,
  currentUrl,
}: {
  listingId: Id<"listings">;
  slot: Slot;
  currentUrl: string | null;
}) {
  const upload = useStorageUpload();
  const replace = useMutation(api.listings.replaceMedia);
  const removeMedia = useMutation(api.admin.removeMedia);

  const [file, setFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // Remounts the picker after an upload so its file input is cleared too.
  const [pickerKey, setPickerKey] = useState(0);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onReplace() {
    if (!file || pickError || busy) return;
    setBusy("upload");
    setError(null);
    setMessage(null);
    try {
      const storageId = await upload(file);
      await replace({ id: listingId, kind: slot.kind, storageId });
      setFile(null);
      setPickerKey((k) => k + 1);
      setMessage(currentUrl ? "Replaced." : "Uploaded.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    if (busy || slot.kind !== "video") return;
    if (!confirm(`Remove the ${slot.label.toLowerCase()}? The file is deleted and can't be restored.`)) return;
    setBusy("remove");
    setError(null);
    setMessage(null);
    try {
      await removeMedia({ id: listingId, kind: "video" });
      setMessage("Removed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid content-start gap-3">
      <MediaPicker
        key={pickerKey}
        id={`media-${slot.kind}`}
        label={slot.label}
        hint={slot.hint}
        kind={slot.media}
        file={file}
        currentUrl={currentUrl}
        aspect={slot.aspect}
        onChange={(f, err) => {
          setFile(f);
          setPickError(err);
          setError(null);
          setMessage(null);
        }}
      />
      {pickError && (
        <p role="alert" className="text-xs font-medium">
          {pickError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {file && !pickError && (
          <button type="button" className="admin-button" disabled={busy !== null} onClick={onReplace}>
            {busy === "upload" ? "Uploading…" : currentUrl ? "Upload & replace" : "Upload"}
          </button>
        )}
        {!file && currentUrl && (
          <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="admin-text-link">
            Open full size <span aria-hidden="true">↗</span>
          </a>
        )}
        {!file && !currentUrl && <span className="text-xs text-black/55">None yet.</span>}
        {slot.removable && currentUrl && !file && (
          <button type="button" className="admin-text-link" disabled={busy !== null} onClick={onRemove}>
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        )}
        {message && (
          <span role="status" className="text-xs text-black/55">
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

/** Screenshots 2–5: reorder, promote to cover, remove, add more. */
function GalleryManager({ listing }: { listing: Listing }) {
  const upload = useStorageUpload();
  const add = useMutation(api.listings.addGalleryImage);
  const remove = useMutation(api.listings.removeGalleryImage);
  const reorder = useMutation(api.listings.setGalleryOrder);
  const makeCover = useMutation(api.listings.makeGalleryCover);

  const gallery = listing.gallery;
  const room = LIMITS.gallery - gallery.length;
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(key: string, work: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await work();
      setMessage(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const ids = gallery.map((g) => g.id);
  const move = (from: number, to: number) => {
    const next = [...ids];
    [next[from], next[to]] = [next[to], next[from]];
    return run(`move-${from}`, () => reorder({ id: listing.id, galleryIds: next }), "Order saved.");
  };

  const onUpload = () =>
    run(
      "upload",
      async () => {
        for (const file of files.slice(0, room)) {
          const storageId = await upload(file);
          await add({ id: listing.id, storageId });
        }
        setFiles([]);
      },
      files.length === 1 ? "Screenshot added." : "Screenshots added.",
    );

  return (
    <div className="grid content-start gap-4">
      <div>
        <p className="admin-eyebrow">
          Screenshots 2–{LIMITS.gallery + 1} · {gallery.length}/{LIMITS.gallery}
        </p>
        <p className="mt-1 text-xs text-black/55">Shown on the listing page after the cover.</p>
      </div>

      {gallery.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {gallery.map((g, i) => (
            <li key={g.id} className="grid content-start gap-2">
              <div className="relative overflow-hidden rounded-xl border border-[var(--line)]" style={{ aspectRatio: "16 / 9" }}>
                {g.url && (
                  <img src={g.url} alt={`Screenshot ${i + 2}`} className="absolute inset-0 size-full object-cover object-top" />
                )}
                <span className="absolute top-1.5 left-1.5 rounded-full bg-white px-2 py-0.5 font-mono text-[10px]">{i + 2}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <button
                  type="button"
                  className="admin-text-link min-h-0"
                  disabled={busy !== null || i === 0}
                  onClick={() => move(i, i - 1)}
                  aria-label={`Move screenshot ${i + 2} earlier`}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="admin-text-link min-h-0"
                  disabled={busy !== null || i === gallery.length - 1}
                  onClick={() => move(i, i + 1)}
                  aria-label={`Move screenshot ${i + 2} later`}
                >
                  →
                </button>
                <button
                  type="button"
                  className="admin-text-link min-h-0"
                  disabled={busy !== null}
                  onClick={() => run(`cover-${i}`, () => makeCover({ id: listing.id, storageId: g.id }), "Cover changed.")}
                >
                  Make cover
                </button>
                <button
                  type="button"
                  className="admin-text-link min-h-0"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!confirm(`Remove screenshot ${i + 2}? The file is deleted and can't be restored.`)) return;
                    void run(`remove-${i}`, () => remove({ id: listing.id, storageId: g.id }), "Removed.");
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {room > 0 && (
        <MultiImagePicker
          id="media-gallery"
          label="Add screenshots"
          hint="16:9 (1920×1080) works best. PNG, JPG or WebP, up to 5 MB each."
          files={files}
          max={room}
          onChange={(next, err) => {
            setFiles(next);
            setError(err);
            setMessage(null);
          }}
        />
      )}

      {error && (
        <p role="alert" className="text-xs font-medium">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {files.length > 0 && (
          <button type="button" className="admin-button" disabled={busy !== null} onClick={onUpload}>
            {busy === "upload" ? "Uploading…" : `Upload ${files.length}`}
          </button>
        )}
        {message && (
          <span role="status" className="text-xs text-black/55">
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

/** All screenshots (cover + up to 4 more) and the video, each replaceable. */
export function MediaPanel({ listing }: { listing: Listing }) {
  return (
    <section className="admin-panel" aria-labelledby="media-heading">
      <p id="media-heading" className="admin-eyebrow mb-2">
        Media
      </p>
      <p className="mb-6 text-xs leading-relaxed text-black/55">
        Up to {LIMITS.gallery + 1} screenshots: the cover plus {LIMITS.gallery} more. Drop new files, then upload
        them. Nothing changes until you press the button.
      </p>
      <div className="grid gap-10">
        <div className="grid gap-8 md:grid-cols-2">
          <MediaSlot listingId={listing.id} slot={SLOTS.cover} currentUrl={listing.coverUrl} />
          <MediaSlot listingId={listing.id} slot={SLOTS.video} currentUrl={listing.videoUrl} />
        </div>
        <GalleryManager listing={listing} />
      </div>
    </section>
  );
}
