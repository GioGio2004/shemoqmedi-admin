"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { NETWORK_LABEL, NETWORK_SHORT, type Network } from "@/lib/studio/captions";
import { KIND_LABEL, nextScheduled } from "@/lib/studio/queue";
import { formatTbilisi, relativeTime } from "@/lib/studio/time";
import { ArrowIcon } from "../icons";
import { useNow } from "../hooks";
import { PushSwitch, PUSH_WORD } from "../PushSwitch";
import { useStudioPush } from "../StudioShell";
import { PageHead, Skel } from "../ui";

type Post = FunctionReturnType<typeof api.social.recent>[number];
type Channel = FunctionReturnType<typeof api.social.channels>[number];

const DAY = 24 * 60 * 60 * 1000;

const USAGE = [
  { href: "https://dashboard.convex.dev", label: "Convex", hint: "Functions, storage, bandwidth" },
  { href: "https://imagekit.io/dashboard", label: "ImageKit", hint: "Images and transforms" },
  { href: "https://vercel.com/dashboard", label: "Vercel", hint: "Deploys, functions, usage" },
];

function greeting(now: number) {
  const h = new Date(now + 4 * 60 * 60 * 1000).getUTCHours();
  return h < 5 ? "Late night." : h < 12 ? "Morning." : h < 18 ? "Afternoon." : "Evening.";
}

/** Home: the queue at a glance, channel health, what went out, quick actions, this device. */
export function Home() {
  const now = useNow(30_000);
  return (
    <>
      <PageHead index="01" section="Studio" title={greeting(now)} />
      <div className="st-bento st-in">
        <QueueTile />
        <NextTile now={now} />
        <section className="st-tile st-span-2 st-d-2" aria-label="Quick actions">
          <p className="st-eyebrow">Make</p>
          <QuickActions />
        </section>
        <ChannelsTile now={now} />
        <RecentTile now={now} />
        <DeviceTile />
        <UsageTile />
      </div>
    </>
  );
}

function QueueTile() {
  const waiting = useQuery(api.social.waitingCount, {});
  return (
    <Link href="/queue" className="st-tile st-tile-ink st-d-2" style={{ minHeight: 168 }}>
      <p className="st-eyebrow">Waiting</p>
      <div className="st-tile-foot">
        {waiting === undefined ? <Skel style={{ height: 70, width: 80, opacity: 0.2 }} /> : <span className="st-big">{waiting}</span>}
        <span className="st-arrow" aria-hidden="true">
          <ArrowIcon size={16} />
        </span>
      </div>
      <span className="sr-only">posts waiting, open the queue</span>
    </Link>
  );
}

function NextTile({ now }: { now: number }) {
  const scheduled = useQuery(api.social.queue, { status: "scheduled" });
  const next = scheduled ? nextScheduled(scheduled) : undefined;
  return (
    <Link href={next ? `/queue?status=scheduled&post=${next.id}` : "/queue?status=scheduled"} className="st-tile st-d-2" style={{ minHeight: 168 }}>
      <div className="st-between">
        <p className="st-eyebrow">Next out</p>
        {scheduled && scheduled.length > 0 && <span className="st-badge" data-tone="mute">{scheduled.length} scheduled</span>}
      </div>
      {next === undefined ? (
        <div className="st-stack">
          <Skel className="st-skel-text" />
          <Skel className="st-skel-text" style={{ width: "40%" }} />
        </div>
      ) : next === null ? (
        <p className="st-note" style={{ marginTop: "auto" }}>
          Nothing scheduled. Publish or schedule a post from the queue.
        </p>
      ) : (
        <div className="st-stack" style={{ marginTop: "auto", gap: 6 }}>
          <p className="st-h2" style={{ overflowWrap: "anywhere" }}>
            {next.listing?.title ?? KIND_LABEL[next.kind] ?? "Post"}
          </p>
          <p className="st-note st-tnum">
            {next.scheduledFor ? `${formatTbilisi(next.scheduledFor, now)} · ${relativeTime(next.scheduledFor, now)}` : "Publishing now"}
            {next.placement === "story" ? " · Story" : ""}
          </p>
        </div>
      )}
    </Link>
  );
}

function QuickActions() {
  return (
    <div className="st-quick" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      <Link href="/create">
        New post <ArrowIcon size={18} />
      </Link>
      <Link href="/create?output=story">
        New story <ArrowIcon size={18} />
      </Link>
      <Link href="/reels">
        New reel <ArrowIcon size={18} />
      </Link>
      <Link href="/reminders?new=1">
        Reminder <ArrowIcon size={18} />
      </Link>
    </div>
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
  return (
    <section className="st-tile st-span-2 st-d-3" aria-labelledby="home-channels">
      <p id="home-channels" className="st-eyebrow">
        Channels
      </p>
      {channels === undefined ? (
        <div className="st-stack">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} style={{ height: 40 }} />
          ))}
        </div>
      ) : (
        <ul className="st-list">
          {channels.map((c) => {
            const h = channelHealth(c, now);
            return (
              <li key={c.network}>
                <span className="st-dot" data-tone={h.tone === "ok" ? "ok" : h.tone === "warn" ? "warn" : undefined} aria-hidden="true" />
                <span className="st-list-main">
                  <span className="st-list-title">{NETWORK_LABEL[c.network as Network]}</span>
                  <span className="st-list-meta" title={h.text}>
                    {h.text}
                  </span>
                </span>
                <span className="st-badge" data-tone={h.tone === "ok" ? "ink" : "mute"}>
                  {h.tone === "ok" ? "Live" : h.tone === "warn" ? "Check" : "Off"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function sentLinks(post: Post) {
  return post.results.filter((r) => r.status === "sent" && r.url);
}

function RecentTile({ now }: { now: number }) {
  const recent = useQuery(api.social.recent, { limit: 5 });
  return (
    <section className="st-tile st-span-2 st-d-3" aria-labelledby="home-recent">
      <div className="st-between">
        <p id="home-recent" className="st-eyebrow">
          Latest published
        </p>
        <Link href="/queue?status=sent" className="st-link">
          All sent
        </Link>
      </div>
      {recent === undefined ? (
        <div className="st-stack">
          {[0, 1, 2].map((i) => (
            <Skel key={i} style={{ height: 52 }} />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <p className="st-note">Nothing published yet.</p>
      ) : (
        <ul className="st-list">
          {recent.map((p) => {
            const image = p.media.find((m) => m.kind === "image");
            return (
              <li key={p.id}>
                {image ? <img className="st-thumb" src={image.url} alt="" loading="lazy" /> : <span className="st-thumb" aria-hidden="true" />}
                <Link href={`/queue?status=sent&post=${p.id}`} className="st-list-main">
                  <span className="st-list-title">{p.listing?.title ?? KIND_LABEL[p.kind] ?? "Post"}</span>
                  <span className="st-list-meta">
                    {KIND_LABEL[p.kind] ?? p.kind}
                    {p.sentAt ? ` · ${formatTbilisi(p.sentAt, now)}` : ""}
                  </span>
                </Link>
                <span className="st-badge-links">
                  {sentLinks(p).map((r) => (
                    <a key={r.network} href={r.url} target="_blank" rel="noopener noreferrer" className="st-badge st-badge-link" aria-label={`View on ${NETWORK_LABEL[r.network as Network]}`}>
                      {NETWORK_SHORT[r.network as Network]}
                    </a>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
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
        {push && <span className="st-badge" data-tone={push.state === "on" ? "blue" : "mute"}>{PUSH_WORD[push.state]}</span>}
      </div>
      <PushSwitch withTest={false} />
      <InstallPrompt />
    </section>
  );
}

function UsageTile() {
  return (
    <section className="st-tile st-tile-soft st-span-2 st-d-3" aria-labelledby="home-usage">
      <p id="home-usage" className="st-eyebrow">
        Usage
      </p>
      <p className="st-note">No usage API to read here: check the free tiers on each dashboard.</p>
      <ul className="st-list">
        {USAGE.map((u) => (
          <li key={u.href}>
            <a href={u.href} target="_blank" rel="noopener noreferrer" className="st-list-main">
              <span className="st-list-title">{u.label}</span>
              <span className="st-list-meta">{u.hint}</span>
            </a>
            <ArrowIcon size={16} />
          </li>
        ))}
      </ul>
    </section>
  );
}
