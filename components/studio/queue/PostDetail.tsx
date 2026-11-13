"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NETWORKS, NETWORK_LABEL, captionsFit, type Network } from "@/lib/studio/captions";
import { KIND_LABEL } from "@/lib/studio/queue";
import { formatTbilisi, relativeTime } from "@/lib/studio/time";
import { CaptionEditor, StoryNetworks } from "../CaptionEditor";
import { AlertIcon, CheckIcon, ClockIcon, ExternalIcon } from "../icons";
import { Lightbox } from "../Lightbox";
import { reducedMotion, springs } from "../liquid";
import { Segmented, SheetError, Sheet, Switch } from "../ui";
import { Carousel, type CarouselControl } from "./Carousel";
import { usePostControls, type PostControls } from "./controls";
import { NetGlyph } from "./glyphs";
import { useCaptionDraft, type OpenFrom } from "./PostCard";
import { Preview } from "./Preview";
import { accountName, formatText, listNames, postTitle, statusKey, statusWord, targetNetworks, type Channels, type Post, type StatusKey } from "./view";

/**
 * The detail sheet for one post, kept live by its id (it stays open while
 * the post moves between tabs). Opens once the post is known: at once from a
 * card, after the first answer from a ?post= link. A link to a post that
 * doesn't exist throws, for the queue's error boundary.
 */
export function PostDetail({ id, initial, open, onClose, now, channels, from }: { id: string; initial: Post | null; open: boolean; onClose: () => void; now: number; channels: Channels; from: OpenFrom | null }) {
  const live = useQuery(api.social.get, { id: id as Id<"socialPosts"> });
  const post = live ?? initial;
  if (!post) return null;
  return <DetailSheet post={post} open={open} onClose={onClose} now={now} channels={channels} from={from} />;
}

/** The card's picture flies into the sheet's (phones; the sheet slides up meanwhile). */
function flyGhost(src: HTMLElement, tgt: HTMLElement) {
  if (!(src instanceof HTMLImageElement) || !src.currentSrc || !src.complete) return;
  const dialog = tgt.closest("dialog");
  const panel = tgt.closest<HTMLElement>(".st-sheet-panel");
  if (!dialog || !panel) return;
  const s = src.getBoundingClientRect();
  const r = tgt.getBoundingClientRect();
  const tf = getComputedStyle(panel).transform;
  const ty = tf && tf !== "none" ? new DOMMatrixReadOnly(tf).m42 : 0;
  const t = { left: r.left, top: r.top - ty, width: r.width, height: r.height };
  if (!s.width || !t.width || s.bottom < 0 || s.top > window.innerHeight) return;
  const g = document.createElement("img");
  g.className = "st-queue-ghost";
  g.alt = "";
  g.src = src.currentSrc;
  Object.assign(g.style, { left: `${t.left}px`, top: `${t.top}px`, width: `${t.width}px`, height: `${t.height}px` });
  dialog.appendChild(g);
  src.style.visibility = "hidden";
  tgt.style.visibility = "hidden";
  const e = springs().snappy;
  const a = g.animate([{ transform: `translate(${s.left - t.left}px, ${s.top - t.top}px) scale(${s.width / t.width}, ${s.height / t.height})` }, { transform: "none" }], { duration: e.d + 60, easing: e.e });
  const end = () => {
    src.style.visibility = "";
    tgt.style.visibility = "";
    g.remove();
  };
  a.finished.then(end, end);
}

type Net2 = "instagram" | "facebook";

function DetailSheet({ post, open, onClose, now, channels, from }: { post: Post; open: boolean; onClose: () => void; now: number; channels: Channels; from: OpenFrom | null }) {
  const c = usePostControls(post, now, { onRejected: onClose });
  const { draft, setDraft, captions, dirty } = useCaptionDraft(post);
  const uid = useId();
  const car = useRef<CarouselControl>(null);
  const [pv, setPv] = useState<Net2>(() => (!post.captions.instagram?.trim() && post.captions.facebook?.trim() ? "facebook" : "instagram"));
  const [capNet, setCapNet] = useState<Network>(() => NETWORKS.find((n) => post.captions[n]?.trim()) ?? "instagram");
  const [memory, setMemory] = useState<Partial<Record<Network, string>>>({});
  const [viewer, setViewer] = useState<{ index: number; el: HTMLElement } | null>(null);

  const { actions, busy } = c;
  const key = statusKey(post, actions);
  const story = post.placement === "story";
  const title = postTitle(post);
  const busyAny = busy !== null;

  // The shared-element feel: the tapped card's picture flies into place.
  useEffect(() => {
    if (!open || !from?.el || reducedMotion() || window.matchMedia("(min-width: 900px)").matches) return;
    const src = from.el;
    const raf = requestAnimationFrame(() => {
      const tgt = car.current?.media(from.index);
      if (tgt) flyGhost(src, tgt);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, from]);

  const toggle = (n: Network, on: boolean) => {
    if (on) setDraft({ ...captions, [n]: memory[n] || post.captions[n] || "" });
    else {
      setMemory((m) => ({ ...m, [n]: captions[n] ?? "" }));
      setDraft({ ...captions, [n]: "" });
    }
  };

  const footer = footerFor({ post, status: key, c, dirty, fits: captionsFit(captions), onSave: () => c.save(draft, () => setDraft(null)), onDiscard: () => setDraft(null), onDone: onClose });

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        eyebrow={`${statusWord(key)} · ${formatText(post)}`}
        subtitle={
          <>
            {KIND_LABEL[post.kind] ?? post.kind} · <span className="st-tnum">made {relativeTime(post.createdAt, now)}</span>
          </>
        }
        size="large"
        detents
        wide
        footer={footer}
      >
        <div className="st-queue-detail">
          <div className="st-queue-detail-media">
            {post.media.length > 0 && (
              <Carousel
                control={car}
                className="st-queue-sheet-media"
                media={post.media}
                label={title}
                story={story}
                eager
                start={from?.index ?? 0}
                sizes="(min-width: 900px) 420px, 100vw"
                top={story ? <span className="st-mchip">Story</span> : undefined}
                onOpen={(index, el) => setViewer({ index, el })}
              />
            )}
            <When post={post} status={key} c={c} now={now} dirty={dirty} />
          </div>

          <div className="st-queue-detail-ctrl">
            <SheetError error={c.error} />
            {post.error && key !== "failed" && (
              <p className="st-callout" data-tone="error">
                {post.error}
              </p>
            )}
            {post.results.length > 0 && <Results post={post} />}

            <section className="st-queue-sec" aria-labelledby={`${uid}-pvh`}>
              <div className="st-sec-head">
                <h3 className="st-h3" id={`${uid}-pvh`}>
                  Preview
                </h3>
                <Segmented
                  size="sm"
                  labelledBy={`${uid}-pvh`}
                  value={pv}
                  onChange={setPv}
                  options={(["instagram", "facebook"] as const).map((n) => ({ value: n, label: NETWORK_LABEL[n], id: `${uid}-pv-${n}`, controls: `${uid}-pv` }))}
                />
              </div>
              <div className="st-queue-pv-wrap" id={`${uid}-pv`} role="tabpanel" aria-labelledby={`${uid}-pv-${pv}`}>
                <Preview key={pv} post={post} net={pv} caption={captions[pv] ?? ""} name={accountName(channels, pv)} onOpen={(el) => setViewer({ index: 0, el })} />
              </div>
            </section>

            {!story && (
              <section className="st-queue-sec" aria-labelledby={`${uid}-caph`}>
                <div className="st-sec-head">
                  <h3 className="st-h3" id={`${uid}-caph`}>
                    Caption
                  </h3>
                  {dirty && <span className="st-badge">Unsaved</span>}
                </div>
                <CaptionEditor
                  value={captions}
                  onChange={setDraft}
                  disabled={busyAny}
                  readOnly={!actions.edit}
                  active={capNet}
                  onActive={(n) => {
                    setCapNet(n);
                    if (n === "instagram" || n === "facebook") setPv(n);
                  }}
                />
                {dirty && <p className="st-note">{actions.editResets ? "Saving sends this post back to Waiting (a schedule is cancelled)." : "Unsaved changes: save them or discard them below."}</p>}
              </section>
            )}

            <section className="st-queue-sec" aria-labelledby={`${uid}-neth`}>
              <div className="st-sec-head">
                <h3 className="st-h3" id={`${uid}-neth`}>
                  {key === "sent" ? "Went to" : "Post to"}
                </h3>
              </div>
              {story ? (
                actions.edit ? (
                  <>
                    <StoryNetworks value={captions} onChange={setDraft} label={post.listing?.title ?? "Story"} disabled={busyAny} accounts={Object.keys(channels).length ? accounts(channels) : undefined} />
                    {dirty && <p className="st-note">{actions.editResets ? "Saving sends this post back to Waiting (a schedule is cancelled)." : "Unsaved changes: save them or discard them below."}</p>}
                  </>
                ) : (
                  <p className="st-note">{targetNetworks(post, post.captions).length ? `Story on ${listNames(targetNetworks(post, post.captions))}.` : "Story, no network picked."}</p>
                )
              ) : (
                <div className="st-inset">
                  {NETWORKS.map((n) => {
                    const ch = channels[n];
                    const connected = ch?.connected ?? true;
                    const has = !!captions[n]?.trim();
                    const restorable = !!(memory[n]?.trim() || post.captions[n]?.trim());
                    const where = ch ? (connected ? (ch.account ?? "Connected") : "Not connected, skipped") : "";
                    const hint = !has && !restorable ? [where, "write a caption to post here"].filter(Boolean).join(" · ") : where;
                    return (
                      <div key={n} className="st-cap-net st-queue-net" data-off={!connected || undefined}>
                        <span className="st-cap-net-ic" aria-hidden="true">
                          <NetGlyph network={n} size={19} />
                        </span>
                        <Switch checked={has} label={NETWORK_LABEL[n]} hint={hint || undefined} disabled={!actions.edit || busyAny || (!has && !restorable)} onChange={(on) => toggle(n, on)} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </Sheet>

      {c.sheets}
      {viewer && (
        <Lightbox
          items={post.media.map((m) => ({ url: m.url, kind: m.kind }))}
          start={viewer.index}
          origin={viewer.el}
          originFor={(i) => car.current?.media(i) ?? null}
          onIndexChange={(i) => car.current?.go(i, false)}
          label={title}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

const accounts = (channels: Channels) => Object.fromEntries(NETWORKS.map((n) => [n, channels[n] ? (channels[n]!.connected ? (channels[n]!.account ?? "Connected") : "Not connected") : null])) as Partial<Record<Network, string | null>>;

/** When it goes (or went), with Pick time / Change and Unschedule. */
function When({ post, status, c, now, dirty }: { post: Post; status: StatusKey; c: PostControls; now: number; dirty: boolean }) {
  const { actions, busy } = c;
  const off = busy !== null || dirty;
  let icon = <ClockIcon size={19} />;
  let head: string;
  let sub: string;
  let failed = false;
  switch (status) {
    case "publishing":
      icon = <span className="st-spin" aria-hidden="true" />;
      head = "Publishing now";
      sub = "Videos can take a few minutes; the results show here.";
      break;
    case "waiting":
      head = post.scheduledFor ? formatTbilisi(post.scheduledFor, now) : "Not scheduled";
      sub = post.scheduledFor ? `Publish time, ${relativeTime(post.scheduledFor, now)} · Tbilisi time` : "Goes out when you publish";
      break;
    case "scheduled":
      if (actions.retry) {
        icon = <AlertIcon size={19} />;
        head = "The publish run stopped";
        sub = "Retry sends the networks that didn't go out.";
        failed = true;
        break;
      }
      head = post.scheduledFor ? formatTbilisi(post.scheduledFor, now) : "As soon as possible";
      sub = post.scheduledFor ? `Scheduled, ${relativeTime(post.scheduledFor, now)} · Tbilisi time` : "Scheduled";
      break;
    case "sent":
      icon = <CheckIcon size={19} />;
      head = post.sentAt ? `Sent ${formatTbilisi(post.sentAt, now)}` : "Sent";
      sub = "Tbilisi time";
      break;
    case "failed":
      icon = <AlertIcon size={19} />;
      head = "Not sent everywhere";
      sub = post.error ?? "Publishing failed.";
      failed = true;
      break;
    case "approved":
      head = "Waiting for a connected account";
      sub = "It goes out once the network is connected, or retry.";
      break;
    case "rejected":
      head = "Rejected";
      sub = post.note ? `Note: ${post.note}` : "This post won't go out.";
      break;
  }
  return (
    <div className="st-inset st-queue-when" data-failed={failed || undefined} aria-live="polite">
      <span className="st-queue-when-ic" aria-hidden="true">
        {icon}
      </span>
      <div className="st-queue-when-tx">
        <b className="st-tnum">{head}</b>
        <small>{sub}</small>
      </div>
      {(actions.schedule || actions.unschedule) && (
        <div className="st-queue-when-acts">
          {actions.unschedule && (
            <button type="button" className="st-btn st-btn-quiet st-btn-sm" onClick={c.unschedule} disabled={off} data-busy={busy === "unschedule"}>
              Unschedule
            </button>
          )}
          {actions.schedule && (
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={c.askSchedule} disabled={off} data-busy={busy === "schedule"}>
              {actions.unschedule ? "Change" : "Pick time"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const RESULT_WORD = { sent: "Sent", failed: "Failed", skipped: "Skipped" } as const;

function Results({ post }: { post: Post }) {
  return (
    <section className="st-queue-sec">
      <div className="st-sec-head">
        <h3 className="st-h3">Results</h3>
      </div>
      <ul className="st-inset st-queue-res" aria-label="Results per network">
        {post.results.map((r) => {
          const name = NETWORK_LABEL[r.network as Network] ?? r.network;
          const msg = r.error ?? r.note;
          return (
            <li key={r.network} data-status={r.status}>
              <div className="st-queue-res-row">
                <span className="st-cap-net-ic" aria-hidden="true">
                  <NetGlyph network={r.network as Network} size={19} />
                </span>
                <b>{name}</b>
                <span className="st-queue-res-st">
                  {r.status === "sent" ? <CheckIcon size={15} /> : <span className={`st-sdot${r.status === "failed" ? " is-failed" : ""}`} aria-hidden="true" />}
                  {RESULT_WORD[r.status]}
                </span>
                {r.url && (
                  <a className="st-btn st-btn-ghost st-btn-sm" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`View on ${name}`}>
                    View
                  </a>
                )}
              </div>
              {msg && <p className="st-queue-res-msg">{msg}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The pinned actions: Save / Discard while there are caption edits, else Reject / Schedule / Publish now (or Retry, or View + Done). */
function footerFor({ post, status, c, dirty, fits, onSave, onDiscard, onDone }: { post: Post; status: StatusKey; c: PostControls; dirty: boolean; fits: boolean; onSave: () => void; onDiscard: () => void; onDone: () => void }) {
  const { actions, busy } = c;
  const any = busy !== null;
  if (dirty && actions.edit) {
    return (
      <>
        <button type="button" className="st-btn st-btn-ghost" onClick={onDiscard} disabled={any}>
          Discard
        </button>
        <button type="button" className="st-btn" onClick={onSave} disabled={any || !fits} data-busy={busy === "save"}>
          Save captions
        </button>
      </>
    );
  }
  if (actions.publishing) return null;
  const buttons = [];
  if (actions.reject)
    buttons.push(
      <button key="reject" type="button" className="st-btn st-btn-ghost" onClick={c.askReject} disabled={any} data-busy={busy === "reject"}>
        Reject
      </button>,
    );
  if (actions.schedule)
    buttons.push(
      <button key="schedule" type="button" className="st-btn st-btn-ghost" onClick={c.askSchedule} disabled={any} data-busy={busy === "schedule"}>
        {actions.unschedule ? "Move time" : "Schedule"}
      </button>,
    );
  if (actions.publishNow)
    buttons.push(
      <button key="publish" type="button" className="st-btn" onClick={c.askPublish} disabled={any} data-busy={busy === "publish"}>
        Publish now
      </button>,
    );
  if (actions.retry)
    buttons.push(
      <button key="retry" type="button" className="st-btn" onClick={c.retry} disabled={any} data-busy={busy === "retry"}>
        {status === "failed" ? "Retry failed" : "Retry"}
      </button>,
    );
  if (status === "sent" && !actions.retry) {
    const link = post.results.find((r) => r.status === "sent" && r.url);
    if (link?.url)
      buttons.push(
        <a key="view" className="st-btn st-btn-ghost" href={link.url} target="_blank" rel="noopener noreferrer">
          View on {NETWORK_LABEL[link.network as Network]} <ExternalIcon size={15} />
        </a>,
      );
    buttons.push(
      <button key="done" type="button" className="st-btn" onClick={onDone}>
        Done
      </button>,
    );
  }
  return buttons.length ? <>{buttons}</> : null;
}
