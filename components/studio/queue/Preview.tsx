"use client";

import { useState } from "react";
import { NETWORK_LABEL } from "@/lib/studio/captions";
import { ikUrl } from "../media";
import { CommentGlyph, GlobeGlyph, HeartGlyph, LikeGlyph, MoreGlyph, SaveGlyph, SendGlyph, ShareGlyph } from "./glyphs";
import type { Post } from "./view";

// How the post will look in the Instagram and Facebook apps: a feed post
// (account, picture, actions, caption cut with "more") or a story frame.
// White on light, black on dark, like the apps themselves (--st-pv-*).

type Net = "instagram" | "facebook";

const LIMIT: Record<Net, number> = { instagram: 125, facebook: 180 };

function Caption({ net, name, text }: { net: Net; name: string; text: string }) {
  const [more, setMore] = useState(false);
  const user = net === "instagram" ? <b>{name} </b> : null;
  const limit = LIMIT[net];
  if (!text.trim()) return <p className="st-queue-pv-cap is-empty">{`No ${NETWORK_LABEL[net]} caption: this post skips ${NETWORK_LABEL[net]}.`}</p>;
  if (more || text.length <= limit) {
    return (
      <p className="st-queue-pv-cap">
        {user}
        {text}
      </p>
    );
  }
  let cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  if (space > limit * 0.6) cut = cut.slice(0, space);
  return (
    <p className="st-queue-pv-cap">
      {user}
      {cut}…{" "}
      <button type="button" className="st-queue-pv-more" onClick={() => setMore(true)}>
        {net === "instagram" ? "more" : "See more"}
      </button>
    </p>
  );
}

function Avatar() {
  return (
    <span className="st-queue-pv-av" aria-hidden="true">
      <span className="st-crow" />
    </span>
  );
}

function Picture({ m, onOpen }: { m: Post["media"][number] | undefined; onOpen?: (el: HTMLElement) => void }) {
  if (!m) return null;
  return (
    <button type="button" className="st-queue-pv-media" aria-label={`View the ${m.kind === "video" ? "video" : "picture"}`} onClick={(e) => onOpen?.(e.currentTarget)}>
      {m.kind === "video" ? (
        <video src={m.url} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
      ) : (
        <img
          ref={(el) => {
            if (el && el.complete && el.naturalWidth) el.classList.add("is-loaded");
          }}
          className="st-fade-img"
          src={ikUrl(m.url, 720)}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
          onError={(e) => e.currentTarget.classList.add("is-loaded")}
        />
      )}
    </button>
  );
}

/** One preview: `net`'s feed post or story, with `caption` as typed (unsaved edits included). */
export function Preview({ post, net, caption, name, onOpen }: { post: Post; net: Net; caption: string; name: string; onOpen?: (el: HTMLElement) => void }) {
  const m = post.media[0];
  const n = post.media.length;

  if (post.placement === "story") {
    return (
      <div className="st-queue-pv-story">
        <div className="st-queue-pv-frame">
          <Picture m={m} onOpen={onOpen} />
          <div className="st-queue-pv-bars" aria-hidden="true">
            {(n ? post.media : [null]).map((_, i) => (
              <i key={i}>
                <b />
              </i>
            ))}
          </div>
          <div className="st-queue-pv-shead" aria-hidden="true">
            <Avatar />
            <span>{name}</span>
            <small>1m</small>
          </div>
          <div className="st-queue-pv-sfoot" aria-hidden="true">
            <span className="st-queue-pv-reply">Send message</span>
            <HeartGlyph />
            <SendGlyph />
          </div>
        </div>
        <p className="st-note st-queue-pv-note">{NETWORK_LABEL[net]} stories show no caption.</p>
      </div>
    );
  }

  const counter = n > 1 ? <span className="st-queue-pv-count">1/{n}</span> : null;

  if (net === "instagram") {
    return (
      <div className="st-queue-pv">
        <div className="st-queue-pv-head">
          <Avatar />
          <div className="st-queue-pv-id">
            <b>{name}</b>
            <small>Tbilisi, Georgia</small>
          </div>
          <MoreGlyph size={20} />
        </div>
        <div className="st-queue-pv-img">
          <Picture m={m} onOpen={onOpen} />
          {counter}
        </div>
        {n > 1 && (
          <div className="st-queue-pv-dots" aria-hidden="true">
            {post.media.map((x, i) => (
              <i key={`${x.url}-${i}`} />
            ))}
          </div>
        )}
        <div className="st-queue-pv-acts" aria-hidden="true">
          <HeartGlyph size={24} />
          <CommentGlyph size={24} />
          <SendGlyph size={24} />
          <span className="st-queue-pv-r">
            <SaveGlyph size={24} />
          </span>
        </div>
        <Caption net="instagram" name={name} text={caption} />
        <span className="st-queue-pv-time">JUST NOW</span>
      </div>
    );
  }

  return (
    <div className="st-queue-pv is-fb">
      <div className="st-queue-pv-head">
        <Avatar />
        <div className="st-queue-pv-id">
          <b>{name}</b>
          <small>
            Just now · <GlobeGlyph size={12} />
          </small>
        </div>
        <MoreGlyph size={20} />
      </div>
      <Caption net="facebook" name={name} text={caption} />
      <div className="st-queue-pv-img">
        <Picture m={m} onOpen={onOpen} />
        {counter}
      </div>
      <div className="st-queue-pv-stats" aria-hidden="true">
        <span>Be the first to react</span>
        <span>0 comments</span>
      </div>
      <div className="st-queue-pv-bar" aria-hidden="true">
        <span>
          <LikeGlyph size={18} />
          Like
        </span>
        <span>
          <CommentGlyph size={18} />
          Comment
        </span>
        <span>
          <ShareGlyph size={18} />
          Share
        </span>
      </div>
    </div>
  );
}
