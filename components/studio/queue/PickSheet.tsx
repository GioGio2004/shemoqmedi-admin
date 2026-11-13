"use client";

import { useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CheckIcon } from "../icons";
import { ikUrl } from "../media";
import { Segmented, Sheet, SheetError, Skel } from "../ui";
import { PlayGlyph } from "./glyphs";
import { MEDIA_MAX, storyItemProblem, type Picked, type PostDetailData } from "./mediaEdit";
import { uploadDeviceImage } from "./upload";

export type PickMode = { type: "add" } | { type: "replace"; index: number };
type Source = "renders" | "listing" | "device";

/**
 * Picks pictures for a post: recent renders (newest first, with their
 * recipes), the listing's current screenshots and preview video, or an
 * image from the device (uploaded to ImageKit at once, then shown as a tile
 * to pick like the others). Add takes several (up to the post's 10); Replace
 * takes one. A story only takes a 9:16 item. Only the Add / Replace button
 * saves (`onPick`); the sheet stays open with the reason when it fails.
 */
export function PickSheet({ open, mode, post, title, resets, onClose, onPick }: { open: boolean; mode: PickMode; post: PostDetailData; title: string; resets: string | null; onClose: () => void; onPick: (items: Picked[]) => Promise<void> }) {
  const uid = useId();
  const first: Source = post.listing ? "listing" : "renders";
  const [source, setSource] = useState<Source>(first);
  const [chosen, setChosen] = useState<Picked[]>([]);
  const [uploaded, setUploaded] = useState<Picked[]>([]);
  const [busy, setBusy] = useState<"save" | "upload" | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Each opening starts fresh (the footer lives outside the sheet's content, so the state lives here).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSource(first);
      setChosen([]);
      setUploaded([]);
      setError(null);
    }
  }
  const file = useRef<HTMLInputElement>(null);
  const finalAuth = useAction(api.graphics.finalUploadAuth);
  const register = useMutation(api.media.registerSocial);

  const renders = useQuery(api.media.recentRenders, open && source === "renders" ? { limit: 40 } : "skip");
  const listing = useQuery(api.social.listingMedia, open && source === "listing" && post.listing ? { id: post.id } : "skip");

  const story = post.placement === "story";
  const replacing = mode.type === "replace";
  const room = replacing ? 1 : Math.max(0, (story ? 1 : MEDIA_MAX) - post.media.length);
  const inPost = new Set(post.media.map((m) => m.url));

  const options: Picked[] | undefined =
    source === "renders"
      ? renders?.map((r) => ({ kind: "image" as const, url: r.url, role: r.role, width: r.width ?? null, height: r.height ?? null, design: r.design, mediaId: r.id }))
      : source === "listing"
        ? listing?.map((l) => ({ kind: l.kind, url: l.url, role: l.role === "preview" ? "preview" : "screenshot", width: l.width, height: l.height, durationSec: l.durationSec }))
        : uploaded;

  function toggle(p: Picked) {
    setError(null);
    if (replacing) {
      setChosen((c) => (c[0]?.url === p.url ? [] : [p]));
      return;
    }
    setChosen((c) => (c.some((x) => x.url === p.url) ? c.filter((x) => x.url !== p.url) : c.length < room ? [...c, p] : c));
  }

  async function save(items: Picked[]) {
    setBusy("save");
    setError(null);
    try {
      await onPick(items);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function upload(f: File) {
    setBusy("upload");
    setError(null);
    let item: Picked;
    try {
      item = await uploadDeviceImage(f, title, () => finalAuth({}), (args) => register(args));
    } catch (err) {
      setError(err);
      setBusy(null);
      return;
    }
    const problem = story ? storyItemProblem(item) : null;
    if (problem) {
      setError(new Error(`${problem} Upload a 9:16 image (1080x1920).`));
      setBusy(null);
      return;
    }
    // Shown and picked, not saved: the Add / Replace button is the yes (an edit can send the post back to Waiting).
    setBusy(null);
    setUploaded((u) => [item, ...u.filter((x) => x.url !== item.url)]);
    if (replacing) setChosen([item]);
    else setChosen((c) => (c.some((x) => x.url === item.url) || c.length >= room ? c : [...c, item]));
  }

  const sources = [
    ...(post.listing ? [{ value: "listing" as const, label: "Listing", id: `${uid}-t-listing`, controls: `${uid}-panel` }] : []),
    { value: "renders" as const, label: "Recent renders", id: `${uid}-t-renders`, controls: `${uid}-panel` },
    { value: "device" as const, label: "Upload", id: `${uid}-t-device`, controls: `${uid}-panel` },
  ];

  const any = busy !== null;

  const footer = (
    <>
      <button type="button" className="st-btn st-btn-ghost" onClick={onClose} disabled={any}>
        Cancel
      </button>
      <button type="button" className="st-btn" onClick={() => save(chosen)} disabled={any || chosen.length === 0} data-busy={busy === "save"}>
        {replacing ? "Replace" : chosen.length > 1 ? `Add ${chosen.length}` : "Add"}
      </button>
    </>
  );

  const grid = (list: Picked[], label: string) => (
    <ul className="st-qp-grid" aria-label={label}>
      {list.map((p) => {
        const on = chosen.some((c) => c.url === p.url);
        const already = inPost.has(p.url);
        const problem = story ? storyItemProblem(p) : null;
        const full = !on && !replacing && chosen.length >= room;
        const why = already ? "In this post" : problem ? "Not 9:16" : null;
        return (
          <li key={p.url}>
            <button
              type="button"
              className="st-qp-item"
              aria-pressed={on}
              disabled={any || !!why || full}
              onClick={() => toggle(p)}
              title={problem ?? undefined}
              aria-label={p.kind === "video" ? describe(p) : undefined}
            >
              {p.kind === "video" ? (
                <>
                  <video src={p.url} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
                  <span className="st-qm-play" aria-hidden="true">
                    <PlayGlyph size={16} />
                  </span>
                </>
              ) : (
                <img src={ikUrl(p.url, 320)} alt={describe(p)} loading="lazy" decoding="async" draggable={false} />
              )}
              {on && (
                <span className="st-qp-check" aria-hidden="true">
                  <CheckIcon size={16} />
                </span>
              )}
              {why && <span className="st-qp-why">{why}</span>}
              {!why && p.design && <span className="st-qp-why">Design saved</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Sheet open={open} onClose={onClose} title={mode.type === "replace" ? `Replace item ${mode.index + 1}` : "Add images"} subtitle={title} size="large" footer={footer}>
      <div className="st-qp">
        <Segmented block label="Where from" value={source} onChange={(s) => setSource(s)} options={sources} />
        <SheetError error={error} />
        {resets && <p className="st-note">{resets}</p>}

        <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-t-${source}`} className="st-qp-panel">
          {source === "device" ? (
            <div className="st-qp-device">
              <p className="st-note">A JPEG, PNG, WebP or HEIC photo. It is resized to 4096 px at most and kept under 5 MB.{story ? " A story needs 9:16 (1080x1920)." : ""}</p>
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (f) upload(f);
                }}
              />
              <button type="button" className="st-btn" onClick={() => file.current?.click()} disabled={any} data-busy={busy === "upload"}>
                {uploaded.length ? "Choose another image" : "Choose an image"}
              </button>
              {uploaded.length > 0 && grid(uploaded, "Uploaded images")}
            </div>
          ) : options === undefined ? (
            <div className="st-qp-grid" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skel key={i} className="st-qp-skel" />
              ))}
            </div>
          ) : options.length === 0 ? (
            <p className="st-note">{source === "listing" ? "This listing has no screenshots yet." : "No renders yet. Make one with New design."}</p>
          ) : (
            grid(options, source === "listing" ? "Listing screenshots" : "Recent renders, newest first")
          )}
        </div>

        {!replacing && <p className="st-note st-qp-room">{room === 0 ? (story ? "A story has one picture already." : `This post has ${MEDIA_MAX} already.`) : story ? "A story takes one 9:16 picture." : `Up to ${room} more.`}</p>}
      </div>
    </Sheet>
  );
}

function describe(p: Picked) {
  if (p.kind === "video") return `${p.role === "preview" ? "Preview video" : "Video"}${p.durationSec ? `, ${Math.round(p.durationSec)} s` : ""}`;
  if (p.design?.kind === "carousel") return `Carousel slide ${p.design.slideIndex + 1} of ${p.design.total}`;
  if (p.design?.kind === "graphic") return `Graphic, ${p.design.template.replace(/_/g, " ")}`;
  if (p.role === "screenshot") return "Screenshot";
  return p.width && p.height ? `Image ${p.width}x${p.height}` : "Image";
}
