"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MediaPicker, useStorageUpload, type UploadKind } from "./MediaUpload";
import { errorMessage } from "./format";

type Listing = NonNullable<FunctionReturnType<typeof api.listings.reviewDetail>>;
type Kind = "cover" | "mobile" | "video";

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
    label: "Desktop screenshot",
    media: "image",
    aspect: "16 / 10",
    hint: "PNG, JPG or WebP, up to 5 MB. Required: it can be replaced, not removed.",
    removable: false,
  },
  mobile: {
    kind: "mobile",
    label: "Mobile screenshot",
    media: "image",
    aspect: "9 / 19.5",
    hint: "PNG, JPG or WebP, up to 5 MB.",
    removable: true,
  },
  video: {
    kind: "video",
    label: "Preview video",
    media: "video",
    aspect: "16 / 10",
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
    if (busy || slot.kind === "cover") return;
    if (!confirm(`Remove the ${slot.label.toLowerCase()}? The file is deleted and can't be restored.`)) return;
    setBusy("remove");
    setError(null);
    setMessage(null);
    try {
      await removeMedia({ id: listingId, kind: slot.kind });
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

/** Current screenshots and video, each replaceable with your own file. */
export function MediaPanel({ listing }: { listing: Listing }) {
  return (
    <section className="admin-panel" aria-labelledby="media-heading">
      <p id="media-heading" className="admin-eyebrow mb-2">
        Media
      </p>
      <p className="mb-6 text-xs leading-relaxed text-black/55">
        Drop a new file on a slot, then upload it. Nothing changes until you press the button.
      </p>
      <div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_200px]">
        <MediaSlot listingId={listing.id} slot={SLOTS.cover} currentUrl={listing.coverUrl} />
        <MediaSlot listingId={listing.id} slot={SLOTS.mobile} currentUrl={listing.mobileUrl} />
        <div className="sm:col-start-1">
          <MediaSlot listingId={listing.id} slot={SLOTS.video} currentUrl={listing.videoUrl} />
        </div>
      </div>
    </section>
  );
}
