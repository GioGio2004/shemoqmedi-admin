"use client";

import { useId, useState } from "react";
import { NETWORKS, NETWORK_LABEL, STORY_NETWORKS, captionCounter, type Captions, type Network } from "@/lib/studio/captions";
import { Switch } from "./ui";

/** "123 / 500", with the near and over states. */
export function Counter({ network, text }: { network: Network; text: string }) {
  const c = captionCounter(network, text);
  const state = c.over ? "over" : c.near ? "near" : undefined;
  return (
    <span className="st-counter" data-state={state}>
      {c.over ? `${c.length - c.max} over · ` : ""}
      {c.length} / {c.max}
      {c.bytes && network === "threads" ? " (emoji count 2–4)" : ""}
    </span>
  );
}

/**
 * Captions per network: one box at a time behind a network switcher (each
 * tab marks whether that network has a caption). A blank caption means the
 * post skips that network.
 */
export function CaptionEditor({ value, onChange, disabled, drafts }: { value: Captions; onChange: (next: Captions) => void; disabled?: boolean; drafts?: Captions }) {
  const [active, setActive] = useState<Network>(() => NETWORKS.find((n) => value[n]?.trim()) ?? "instagram");
  const id = useId();
  const text = value[active] ?? "";
  const draft = drafts?.[active];
  return (
    <div className="st-stack">
      <div className="st-net-tabs" role="tablist" aria-label="Network">
        {NETWORKS.map((n) => {
          const has = !!value[n]?.trim();
          const over = captionCounter(n, value[n] ?? "").over;
          return (
            <button key={n} type="button" role="tab" id={`${id}-${n}`} aria-selected={n === active} aria-controls={`${id}-panel`} onClick={() => setActive(n)}>
              <span className="st-dot" data-tone={over ? "warn" : has ? "ok" : undefined} aria-hidden="true" />
              {NETWORK_LABEL[n]}
              <span className="sr-only">{has ? ", has a caption" : ", skipped"}</span>
            </button>
          );
        })}
      </div>
      <div className="st-field" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`}>
        <div className="st-label">
          <span>{text.trim() ? `${NETWORK_LABEL[active]} caption` : `Not posting to ${NETWORK_LABEL[active]}`}</span>
          <Counter network={active} text={text} />
        </div>
        <textarea
          className="st-input"
          rows={7}
          value={text}
          disabled={disabled}
          aria-label={`${NETWORK_LABEL[active]} caption`}
          placeholder={`Write the ${NETWORK_LABEL[active]} caption, or leave it blank to skip ${NETWORK_LABEL[active]}.`}
          onChange={(e) => onChange({ ...value, [active]: e.target.value })}
        />
        <div className="st-row">
          {draft && draft !== text && (
            <button type="button" className="st-btn st-btn-quiet st-btn-sm" disabled={disabled} onClick={() => onChange({ ...value, [active]: draft })}>
              {text.trim() ? "Use the draft" : "Write a draft"}
            </button>
          )}
          {text.trim() && (
            <button type="button" className="st-btn st-btn-quiet st-btn-sm" disabled={disabled} onClick={() => onChange({ ...value, [active]: "" })}>
              Skip {NETWORK_LABEL[active]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Stories show no caption: the networks are picked by switches (a story's
 * caption only chooses where it goes, so a short label is stored).
 */
export function StoryNetworks({ value, onChange, label, disabled }: { value: Captions; onChange: (next: Captions) => void; label: string; disabled?: boolean }) {
  return (
    <div className="st-stack" style={{ gap: 0 }}>
      {STORY_NETWORKS.map((n) => (
        <Switch
          key={n}
          checked={!!value[n]?.trim()}
          disabled={disabled}
          onChange={(on) => onChange({ ...value, [n]: on ? value[n]?.trim() || label : "" })}
          label={`${NETWORK_LABEL[n]} story`}
        />
      ))}
      <p className="st-note">Stories show no text. Threads and LinkedIn have no stories, so they are skipped.</p>
    </div>
  );
}
