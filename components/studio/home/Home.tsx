"use client";

import "@/app/studio/screens/home.css";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { NETWORK_LABEL, NETWORK_SHORT, type Network } from "@/lib/studio/captions";
import { KIND_LABEL, nextScheduled } from "@/lib/studio/queue";
import { formatTbilisi, relativeTime } from "@/lib/studio/time";
import { useAmbient } from "../Ambient";
import { ArrowIcon, BellIcon, ExternalIcon, PlusIcon, ReelIcon } from "../icons";
import { useNow } from "../hooks";
import { Lightbox } from "../Lightbox";
import { PushSwitch, PUSH_WORD } from "../PushSwitch";
import { useStudioPush } from "../StudioShell";
import { PageHead, Skel } from "../ui";
import { FadeImg, firstImage, StoryIcon, Thumb } from "./media";

type Post = FunctionReturnType<typeof api.social.recent>[number];
type Channel = FunctionReturnType<typeof api.social.channels>[number];

const DAY = 24 * 60 * 60 * 1000;

const USAGE = [
  { href: "https://dashboard.convex.dev", label: "Convex", hint: "Functions, storage, bandwidth" },
  { href: "https://imagekit.io/dashboard", label: "ImageKit", hint: "Images and transforms" },
  { href: "https://vercel.com/dashboard", label: "Vercel", hint: "Deploys, functions, usage" },
];

const DATE_LINE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Tbilisi" });

function greeting(now: number) {
  const h = new Date(now + 4 * 60 * 60 * 1000).getUTCHours();
  return h < 5 ? "Late night." : h < 12 ? "Morning." : h < 18 ? "Afternoon." : "Evening.";
}

const postTitle = (p: Pick<Post, "listing" | "kind">) => p.listing?.title ?? KIND_LABEL[p.kind] ?? "Post";

/** Home: the queue at a glance, channel health, what went out, quick actions, this device. */
export function Home() {
  const now = useNow(30_000);
  const scheduled = useQuery(api.social.queue, { status: "scheduled" });
  const recent = useQuery(api.social.recent, { limit: 5 });
  const next = scheduled ? nextScheduled(scheduled) : undefined;
  // The background: the next post's picture and what went out last.
  useAmbient([next ? firstImage(next)?.url : null, ...(recent ?? []).map((p) => firstImage(p)?.url)]);

  return (
    <div className="st-home">
      <PageHead section={DATE_LINE.format(now)} title={greeting(now)} />
      <div className="st-bento st-in">
        <QueueTile />
        <NextTile now={now} scheduled={scheduled} next={next} />
        <QuickTile />
        <RecentSection now={now} recent={recent} />
        <ChannelsTile now={now} />
        <DeviceTile />
        <UsageTile />
      </div>
    </div>
  );
}

function QueueTile() {
  const waiting = useQuery(api.social.waitingCount, {});
  return (
    <Link href="/queue" className="st-tile st-tile-ink st-home-tile lq st-d-2">
      <div className="st-between">
        <p className="st-eyebrow">Waiting</p>
        <span className="st-arrow" aria-hidden="true">
          <ArrowIcon size={16} />
        </span>
      </div>
      <div className="st-tile-foot">
        {waiting === undefined ? (
          <Skel className="st-home-skel-big" />
        ) : (
          <span className="st-big" aria-live="polite">
            {waiting}
          </span>
        )}
      </div>
      <span className="st-home-hint">{waiting === 0 ? "All clear" : "To review"}</span>
      <span className="sr-only">posts waiting, open the queue</span>
    </Link>
  );
}

function NextTile({ now, scheduled, next }: { now: number; scheduled: Post[] | undefined; next: Post | null | undefined }) {
  const href = next ? `/queue?status=scheduled&post=${next.id}` : "/queue?status=scheduled";
  const count = scheduled && scheduled.length > 0 ? <span className="st-mchip">{scheduled.length} scheduled</span> : null;
  const when = next ? (
    <p className="st-home-next-when">
      {next.scheduledFor ? `${formatTbilisi(next.scheduledFor, now)} · ${relativeTime(next.scheduledFor, now)}` : "Publishing now"}
      {next.placement === "story" ? " · Story" : ""}
    </p>
  ) : null;
  const image = next ? firstImage(next) : null;

  if (next && image) {
    return (
      <Link href={href} className="st-tile st-home-tile st-home-flush lq st-d-2">
        <div className="st-home-next-pic">
          <FadeImg url={image.url} width={480} widths={[240, 480, 720]} sizes="(min-width: 900px) 360px, 50vw" />
          <div className="st-media-top">
            <span className="st-mchip">Next out</span>
            {count}
          </div>
        </div>
        <div className="st-home-next-body">
          <p className="st-home-next-title">{postTitle(next)}</p>
          {when}
        </div>
      </Link>
    );
  }

  return (
    <Link href={href} className="st-tile st-home-tile lq st-d-2">
      <div className="st-between">
        <p className="st-eyebrow">Next out</p>
        {scheduled && scheduled.length > 0 && (
          <span className="st-badge" data-tone="mute">
            {scheduled.length} scheduled
          </span>
        )}
      </div>
      {next === undefined ? (
        <div className="st-stack" style={{ marginTop: "auto" }}>
          <Skel className="st-skel-text" />
          <Skel className="st-skel-text" style={{ width: "40%" }} />
        </div>
      ) : next === null ? (
        <p className="st-note" style={{ marginTop: "auto" }}>
          Nothing scheduled. Publish or schedule a post from the queue.
        </p>
      ) : (
        <div className="st-home-next-body is-bare">
          <p className="st-home-next-title">{postTitle(next)}</p>
          {when}
        </div>
      )}
    </Link>
  );
}

function QuickTile() {
  return (
    <section className="st-tile st-span-2 st-d-2" aria-labelledby="home-make">
      <p id="home-make" className="st-eyebrow">
        Make
      </p>
      <div className="st-home-quick">
        <Link href="/create" className="st-btn">
          <PlusIcon /> New post
        </Link>
        <Link href="/create?output=story" className="st-btn st-btn-ghost">
          <StoryIcon /> New story
        </Link>
        <Link href="/reels" className="st-btn st-btn-ghost">
          <ReelIcon /> New reel
        </Link>
        <Link href="/reminders?new=1" className="st-btn st-btn-ghost">
          <BellIcon /> Reminder
        </Link>
      </div>
    </section>
  );
}

function channelHealth(c: Channel, now: number): { tone: "ok" | "warn" | "off"; text: string } {
  if (!c.connected) return { tone: "off", text: `Not connected (${c.envVar})` };
  if (c.lastError) return { tone: "warn", text: c.lastError };
  if (c.expiresAt && c.expiresAt < now) return { tone: "warn", text: "Token expired" };
  if (c.expiresAt && c.expiresAt < now + 10 * DAY) return { tone: "warn", text: `Token expires ${relativeTime(c.expiresAt, now)}` };
  return { tone: "ok", text: c.account ?? "Connected" };
}

function ChannelsTile({ now }: { now: number }) {
  const channels = useQuery(api.social.channels, {});
  const health = channels?.map((c) => ({ c, h: channelHealth(c, now) }));
  const live = health?.filter((x) => x.h.tone === "ok").length ?? 0;
  return (
    <section className="st-tile st-span-2 st-d-3" aria-labelledby="home-channels">
      <div className="st-between">
        <p id="home-channels" className="st-eyebrow">
          Channels
        </p>
        {health && (
          <span className="st-badge" data-tone="mute" aria-live="polite">
            {live} of {health.length} live
          </span>
        )}
      </div>
      {health === undefined ? (
        <div className="st-home-nets">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} className="st-home-skel-net" />
          ))}
        </div>
      ) : (
        <ul className="st-home-nets">
          {health.map(({ c, h }) => (
            <li key={c.network} className="st-inset st-home-net" data-tone={h.tone}>
              <span className="st-home-net-top">
                <span className="st-dot" data-tone={h.tone === "ok" ? "ok" : h.tone === "warn" ? "warn" : undefined} aria-hidden="true" />
                <span className="st-home-net-name">{NETWORK_LABEL[c.network as Network]}</span>
                <span className="st-badge" data-tone={h.tone === "ok" ? "ink" : "mute"}>
                  {h.tone === "ok" ? "Live" : h.tone === "warn" ? "Check" : "Off"}
                </span>
              </span>
              <span className="st-home-net-meta" title={h.text}>
                {h.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function sentLinks(post: Post) {
  return post.results.filter((r) => r.status === "sent" && r.url);
}

type Viewer = { post: Post; el: Element | null };

function RecentSection({ now, recent }: { now: number; recent: Post[] | undefined }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  return (
    <section className="st-home-sec st-span-2 st-d-6" aria-labelledby="home-recent">
      <div className="st-home-sec-head">
        <h2 id="home-recent" className="st-h2">
          Latest published
        </h2>
        <Link href="/queue?status=sent" className="st-link">
          All sent
        </Link>
      </div>
      {recent === undefined ? (
        <div className="st-home-pubs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="st-home-pub-skel">
              <Skel className="st-home-skel-pic" />
              <Skel className="st-skel-text" />
            </div>
          ))}
        </div>
      ) : recent.length === 0 ? (
        <p className="st-empty">Nothing published yet.</p>
      ) : (
        <ul className="st-home-pubs">
          {recent.map((p) => {
            const media = p.media;
            const label = postTitle(p);
            return (
              <li key={p.id} className="st-card is-flush st-home-pub">
                <div className="st-card-media">
                  {media.length > 0 ? (
                    <button
                      type="button"
                      className="st-home-pic lq st-home-sp"
                      aria-label={media.length > 1 ? `View ${media.length} pictures of ${label}` : `View the picture of ${label}`}
                      onClick={(e) => setViewer({ post: p, el: e.currentTarget.querySelector("img, video") ?? e.currentTarget })}
                    >
                      <Thumb item={firstImage(p) ?? media[0]} />
                    </button>
                  ) : (
                    <span className="st-home-pic-none">{KIND_LABEL[p.kind] ?? "Post"}</span>
                  )}
                  <div className="st-media-top" aria-hidden="true">
                    <span className="st-mchip">{p.placement === "story" ? "Story" : (KIND_LABEL[p.kind] ?? p.kind)}</span>
                    {media.length > 1 && <span className="st-mchip">{media.length}</span>}
                  </div>
                </div>
                <div className="st-card-body">
                  <Link href={`/queue?status=sent&post=${p.id}`} className="st-home-pub-link">
                    <span className="st-home-pub-title">{label}</span>
                    <span className="st-home-pub-meta">{p.sentAt ? formatTbilisi(p.sentAt, now) : (KIND_LABEL[p.kind] ?? p.kind)}</span>
                  </Link>
                  {sentLinks(p).length > 0 && (
                    <span className="st-badge-links">
                      {sentLinks(p).map((r) => (
                        <a key={r.network} href={r.url} target="_blank" rel="noopener noreferrer" className="st-badge st-badge-link" aria-label={`View on ${NETWORK_LABEL[r.network as Network]}`}>
                          {NETWORK_SHORT[r.network as Network]}
                        </a>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {viewer && (
        <Lightbox
          items={viewer.post.media.map((m, i) => ({ url: m.url, kind: m.kind, alt: `${postTitle(viewer.post)}, ${i + 1} of ${viewer.post.media.length}` }))}
          start={Math.max(0, viewer.post.media.indexOf(firstImage(viewer.post) ?? viewer.post.media[0]))}
          origin={viewer.el}
          label={postTitle(viewer.post)}
          onClose={() => setViewer(null)}
        />
      )}
    </section>
  );
}

function DeviceTile() {
  const push = useStudioPush();
  return (
    <section className="st-tile st-span-2 st-d-3" aria-labelledby="home-device">
      <div className="st-between">
        <p id="home-device" className="st-eyebrow">
          This device
        </p>
        {push && (
          <span className="st-badge" data-tone={push.state === "on" ? "ink" : "mute"}>
            {PUSH_WORD[push.state]}
          </span>
        )}
      </div>
      <PushSwitch withTest={false} />
      <InstallPrompt />
    </section>
  );
}

function UsageTile() {
  return (
    <section className="st-tile st-tile-soft st-span-2 st-d-6" aria-labelledby="home-usage">
      <p id="home-usage" className="st-eyebrow">
        Usage
      </p>
      <p className="st-note">No usage API to read here: check the free tiers on each dashboard.</p>
      <ul className="st-home-usage">
        {USAGE.map((u) => (
          <li key={u.href}>
            <a href={u.href} target="_blank" rel="noopener noreferrer" className="st-home-use lq">
              <span className="st-home-use-main">
                <span className="st-list-title">{u.label}</span>
                <span className="st-list-meta">{u.hint}</span>
              </span>
              <ExternalIcon size={18} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
