"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClipSource } from "@/lib/reel/recipe";
import { uploadDeviceImage } from "../../queue/upload";
import { SearchIcon, ReelIcon } from "../../icons";
import { Segmented, Sheet, SheetError, Skel } from "../../ui";
import { ClipThumb } from "./ClipThumb";
import { UploadIcon } from "./icons";
import { uploadClipVideo } from "./upload";

// "Add clips": pick sources from several places at once ("fusion"): listings
// (their preview videos and screenshots, from as many listings as wanted),
// graphics rendered in the Studio (as title cards), and files from the
// device (videos to R2, pictures to ImageKit). The picks keep their order.

type Tab = "listings" | "graphics" | "uploads";

type Props = {
  open: boolean;
  onClose: () => void;
  onAdd: (sources: ClipSource[]) => void;
  /** Quick reel: one listing's preview, then the voice. */
  quick?: boolean;
};

const clean = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === null || o[k] === undefined) delete o[k];
  return o;
};

function fileSource(
  kind: ClipSource["kind"],
  f: { url: string; mediaId: string | null; width: number | null; height: number | null; durationSec?: number | null },
  extra: Partial<ClipSource>,
): ClipSource {
  return clean({ kind, url: f.url, mediaId: f.mediaId ?? undefined, width: f.width ?? undefined, height: f.height ?? undefined, durationSec: f.durationSec ?? undefined, ...extra });
}

function Tile({ source, picked, onToggle, label, meta }: { source: ClipSource; picked: number; onToggle: () => void; label: string; meta?: string }) {
  return (
    <button type="button" className="st-re-src" aria-pressed={picked > 0} onClick={onToggle} aria-label={`${label}${meta ? `, ${meta}` : ""}${picked ? `, picked ${picked}` : ""}`}>
      <span className="st-re-thumb">
        <ClipThumb source={source} width={240} />
      </span>
      <span className="st-re-src-label">
        <b>{label}</b>
        {meta && <small className="st-tnum">{meta}</small>}
      </span>
      {picked > 0 && (
        <span className="st-re-src-n st-tnum" aria-hidden="true">
          {picked}
        </span>
      )}
    </button>
  );
}

function ListingSources({ listingId, order, toggle }: { listingId: Id<"listings">; order: string[]; toggle: (s: ClipSource) => void }) {
  const data = useQuery(api.reels.listingSources, { listingId });
  if (data === undefined) {
    return (
      <div className="st-re-src-grid" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <Skel key={i} className="st-re-src-skel" />
        ))}
      </div>
    );
  }
  if (data === null) return <p className="st-note">This listing is gone.</p>;
  const base = { listingId: data.id, listingSlug: data.slug };
  const tiles: { source: ClipSource; label: string; meta?: string }[] = [];
  if (data.video) {
    tiles.push({
      source: fileSource("listingVideo", data.video, { ...base, label: `${data.title} preview`.slice(0, 120) }),
      label: "Preview video",
      meta: data.video.durationSec ? `${data.video.durationSec.toFixed(1)} s` : "Video",
    });
  }
  data.screenshots.forEach((s, i) => {
    tiles.push({
      source: fileSource("screenshot", s, { ...base, label: `${data.title} ${i === 0 ? "cover" : `screenshot ${i}`}`.slice(0, 120) }),
      label: i === 0 ? "Cover" : `Screenshot ${i}`,
    });
  });
  if (!tiles.length) return <p className="st-note">No video or screenshots yet.</p>;
  return (
    <div className="st-re-src-grid">
      {tiles.map((t) => (
        <Tile key={t.source.url} source={t.source} label={t.label} meta={t.meta} picked={order.indexOf(t.source.url) + 1} onToggle={() => toggle(t.source)} />
      ))}
    </div>
  );
}

function Listings({ order, toggle, quick }: { order: string[]; toggle: (s: ClipSource) => void; quick?: boolean }) {
  const searchId = useId();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Id<"listings"> | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);
  const listings = useQuery(api.reels.listings, { text: query || undefined, limit: 60 });
  const shown = quick ? listings?.filter((l) => l.hasVideo) : listings;
  return (
    <div className="st-stack">
      <div className="st-search">
        <SearchIcon size={18} />
 <input id={searchId} className="st-input" type="search" aria-label="Search listings" placeholder="Search listings" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search" />
      </div>
      {shown === undefined ? (
        <div className="st-stack" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} style={{ height: 60, borderRadius: 18 }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="st-note">{quick ? "No listings with a preview video match." : "No listings match."}</p>
      ) : (
        <ul className="st-re-listings">
          {shown.map((l) => {
            const isOpen = open === l.id;
            const n = order.filter((u) => u.startsWith(`${l.id}|`)).length;
            return (
              <li key={l.id} className="st-re-listing" data-open={isOpen || undefined}>
                <button type="button" className="st-re-listing-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.id)}>
                  <span className="st-re-listing-cover">{l.coverUrl ? <ClipThumb source={{ kind: "screenshot", url: l.coverUrl }} width={120} /> : <ReelIcon size={18} />}</span>
                  <span className="st-re-listing-text">
                    <b>{l.title}</b>
                    <small>
                      {l.creditName}
                      {l.hasVideo ? " · video" : ""}
                    </small>
                  </span>
                  {n > 0 && <span className="st-badge st-tnum">{n}</span>}
                </button>
                {isOpen && <ListingSources listingId={l.id} order={order.map((u) => u.split("|")[1] ?? u)} toggle={toggle} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Graphics({ order, toggle }: { order: string[]; toggle: (s: ClipSource) => void }) {
  const renders = useQuery(api.media.recentRenders, { limit: 60 });
  if (renders === undefined) {
    return (
      <div className="st-re-src-grid" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skel key={i} className="st-re-src-skel" />
        ))}
      </div>
    );
  }
  if (!renders.length) return <p className="st-note">No graphics yet. Make one in Create, then add it here as a title card.</p>;
  return (
    <div className="st-re-src-grid">
      {renders.map((r) => {
        const source = fileSource("graphic", { url: r.url, mediaId: r.id, width: r.width, height: r.height }, { label: r.role === "carousel" ? "Carousel slide" : "Graphic" });
        return <Tile key={r.id} source={source} label={r.role === "carousel" ? "Slide" : "Graphic"} meta={r.width && r.height ? `${r.width}×${r.height}` : undefined} picked={order.indexOf(r.url) + 1} onToggle={() => toggle(source)} />;
      })}
    </div>
  );
}

function Uploads({ order, toggle }: { order: string[]; toggle: (s: ClipSource) => void }) {
  const uploads = useQuery(api.reels.uploads, { limit: 60 });
  const getUrl = useAction(api.reels.uploadUrl);
  const register = useMutation(api.reels.registerUpload);
  const finalAuth = useAction(api.graphics.finalUploadAuth);
  const registerSocial = useMutation(api.media.registerSocial);
  const videoInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ label: string; fraction?: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<ClipSource[]>([]);

  async function onVideo(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy({ label: "Uploading the video", fraction: 0 });
    try {
      const source = await uploadClipVideo(
        file,
        { uploadUrl: (a) => getUrl({ contentType: a.contentType, size: a.size }), register: (a) => register(a) },
        (fraction) => setBusy({ label: "Uploading the video", fraction }),
      );
      setAdded((list) => [source, ...list]);
      toggle(source);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function onImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy({ label: "Uploading the picture" });
    try {
      let mediaId: string | undefined;
      const picked = await uploadDeviceImage(
        file,
        file.name.replace(/\.[^.]+$/, "") || "reel",
        () => finalAuth({}),
        async (a) => {
          mediaId = await registerSocial(a);
          return mediaId;
        },
      );
      const source = clean<ClipSource>({ kind: "upload-image", url: picked.url, mediaId, width: picked.width ?? undefined, height: picked.height ?? undefined, label: "Uploaded picture" });
      setAdded((list) => [source, ...list]);
      toggle(source);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const known = new Set(added.map((a) => a.url));
  const videos = (uploads ?? []).filter((u) => !known.has(u.url));

  return (
    <div className="st-stack">
      <div className="st-sheet-foot">
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => videoInput.current?.click()} disabled={busy !== null}>
          <UploadIcon size={18} />
          Upload video
        </button>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => imageInput.current?.click()} disabled={busy !== null}>
          <UploadIcon size={18} />
          Upload picture
        </button>
      </div>
      <input
        ref={videoInput}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
        hidden
        onChange={(e) => {
          void onVideo(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p className="st-note">Videos: MP4, MOV or WebM up to 200 MB. Pictures: JPEG or PNG.</p>
      {busy && (
        <div className="st-inset st-re-busy" role="status">
          <div className="st-progress" data-indeterminate={busy.fraction === undefined}>
            <span style={busy.fraction !== undefined ? { width: `${Math.round(busy.fraction * 100)}%` } : undefined} />
          </div>
          <p className="st-note st-tnum">
            {busy.label}
            {busy.fraction !== undefined ? ` ${Math.round(busy.fraction * 100)}%` : "…"}
          </p>
        </div>
      )}
      <SheetError error={error} />
      {uploads === undefined && !added.length ? (
        <div className="st-re-src-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skel key={i} className="st-re-src-skel" />
          ))}
        </div>
      ) : added.length + videos.length === 0 ? (
        <p className="st-note">Nothing uploaded yet.</p>
      ) : (
        <div className="st-re-src-grid">
          {added.map((s) => (
            <Tile key={s.url} source={s} label={s.kind === "upload-video" ? "Video" : "Picture"} meta="Just now" picked={order.indexOf(s.url) + 1} onToggle={() => toggle(s)} />
          ))}
          {videos.map((u) => {
            const source = fileSource("upload-video", { url: u.url, mediaId: u.id, width: u.width, height: u.height, durationSec: u.durationSec }, { label: "Uploaded video" });
            return (
              <Tile
                key={u.id}
                source={source}
                label="Video"
                meta={u.durationSec ? `${u.durationSec.toFixed(1)} s` : new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                picked={order.indexOf(u.url) + 1}
                onToggle={() => toggle(source)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export const SourcePicker = memo(function SourcePicker({ open, onClose, onAdd, quick }: Props) {
  const [tab, setTab] = useState<Tab>("listings");
  // Picks in order: url → source (a listing's picks are also keyed by listing, for the per-listing count).
  const [picked, setPicked] = useState<Map<string, ClipSource>>(() => new Map());
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPicked(new Map());
      setTab("listings");
    }
  }

  const keyOf = (s: ClipSource) => (s.listingId ? `${s.listingId}|${s.url}` : s.url);
  const order = [...picked.keys()];
  const urls = order.map((k) => k.split("|").pop() ?? k);
  function toggle(s: ClipSource) {
    setPicked((m) => {
      const next = new Map(m);
      const k = keyOf(s);
      if (quick) {
        // One listing video for the quick reel.
        if (next.has(k)) next.delete(k);
        else {
          next.clear();
          next.set(k, s);
        }
        return next;
      }
      if (next.has(k)) next.delete(k);
      else next.set(k, s);
      return next;
    });
  }
  const count = picked.size;
  const quickOk = quick ? [...picked.values()].some((s) => s.kind === "listingVideo") : true;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={quick ? "Quick reel" : "Add clips"}
      subtitle={quick ? "Pick a listing's preview video. Then write the voice." : "Pick as many as you like, from anywhere. They go in the order you pick them."}
      size="large"
      footer={
        <>
          <button type="button" className="st-btn st-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="st-btn"
            disabled={count === 0 || !quickOk}
            onClick={() => {
              onAdd([...picked.values()]);
              onClose();
            }}
          >
            {quick ? "Use this video" : count > 1 ? `Add ${count} clips` : "Add clip"}
          </button>
        </>
      }
    >
      {!quick && (
        <Segmented
          label="Where from"
          block
          value={tab}
          onChange={setTab}
          options={[
            { value: "listings", label: "Listings" },
            { value: "graphics", label: "Graphics" },
            { value: "uploads", label: "Uploads" },
          ]}
        />
      )}
      {tab === "listings" && <Listings order={order} toggle={toggle} quick={quick} />}
      {tab === "graphics" && <Graphics order={urls} toggle={toggle} />}
      {tab === "uploads" && <Uploads order={urls} toggle={toggle} />}
    </Sheet>
  );
});
