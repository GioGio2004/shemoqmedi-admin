"use client";

import "@/app/studio/screens/captions.css";
import { useId, useState } from "react";
import { NETWORKS, NETWORK_LABEL, STORY_NETWORKS, captionCounter, type Captions, type Network } from "@/lib/studio/captions";
import { NetGlyph } from "./queue/glyphs";
import { Segmented, Switch } from "./ui";

/** "123 / 500", with the near and over states. */
export function Counter({ network, text }: { network: Network; text: string }) {
  const c = captionCounter(network, text);
  const state = c.over ? "over" : c.near ? "near" : undefined;
  return (
    <span className="st-counter" data-state={state}>
      {c.over ? `${c.length - c.max} over · ` : ""}
      {c.length.toLocaleString("en-US")} / {c.max.toLocaleString("en-US")}
      {c.bytes && network === "threads" ? " (emoji count 2–4)" : ""}
    </span>
  );
}

/**
 * Captions per network: one box at a time behind a segmented network
 * switcher (each option marks whether that network has a caption, or is
 * over its limit). A blank caption means the post skips that network.
 * `active`/`onActive` make the open network controlled (the queue's sheet
 * keeps its preview on the same network); `readOnly` shows sent captions.
 */
export function CaptionEditor({
  value,
  onChange,
  disabled,
  drafts,
  active: activeProp,
  onActive,
  readOnly = false,
}: {
  value: Captions;
  onChange: (next: Captions) => void;
  disabled?: boolean;
  drafts?: Captions;
  active?: Network;
  onActive?: (network: Network) => void;
  readOnly?: boolean;
}) {
  const [own, setOwn] = useState<Network>(() => NETWORKS.find((n) => value[n]?.trim()) ?? "instagram");
  const active = activeProp ?? own;
  const pick = (n: Network) => {
    setOwn(n);
    onActive?.(n);
  };
  const id = useId();
  const text = value[active] ?? "";
  const draft = drafts?.[active];
  const label = NETWORK_LABEL[active];
  return (
    <div className="st-cap">
      <Segmented
        className="st-cap-tabs"
        size="sm"
        label="Network"
        value={active}
        onChange={pick}
        options={NETWORKS.map((n) => {
          const has = !!value[n]?.trim();
          const over = captionCounter(n, value[n] ?? "").over;
          return {
            value: n,
            id: `${id}-${n}`,
            controls: `${id}-panel`,
            label: (
              <>
                <span className="st-cap-tab-dot" data-state={over ? "over" : has ? "on" : undefined} aria-hidden="true" />
                <NetGlyph network={n} size={16} className="st-cap-tab-ic" />
                <span className="st-cap-tab-name">{NETWORK_LABEL[n]}</span>
                <span className="sr-only">{over ? ", over the limit" : has ? ", has a caption" : ", skipped"}</span>
              </>
            ),
          };
        })}
      />
      <div className="st-cap-box" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`} data-readonly={readOnly || undefined}>
        <textarea
          className="st-cap-text"
          rows={6}
          value={text}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={`${label} caption`}
          placeholder={readOnly ? `No ${label} caption.` : `Write the ${label} caption, or leave it blank to skip ${label}.`}
          onChange={(e) => onChange({ ...value, [active]: e.target.value })}
        />
        <div className="st-cap-foot">
          <span>{readOnly ? "Sent captions can't be edited" : text.trim() ? `${label} caption` : `Not posting to ${label}`}</span>
          <Counter network={active} text={text} />
        </div>
      </div>
      {!readOnly && ((draft && draft !== text) || text.trim()) && (
        <div className="st-row">
          {draft && draft !== text && (
            <button type="button" className="st-btn st-btn-quiet st-btn-sm" disabled={disabled} onClick={() => onChange({ ...value, [active]: draft })}>
              {text.trim() ? "Use the draft" : "Write a draft"}
            </button>
          )}
          {text.trim() && (
            <button type="button" className="st-btn st-btn-quiet st-btn-sm" disabled={disabled} onClick={() => onChange({ ...value, [active]: "" })}>
              Skip {label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Stories show no caption: the networks are picked by switches (a story's
 * caption only chooses where it goes, so a short label is stored).
 * `accounts` (optional) names the connected account under each network.
 */
export function StoryNetworks({
  value,
  onChange,
  label,
  disabled,
  accounts,
}: {
  value: Captions;
  onChange: (next: Captions) => void;
  label: string;
  disabled?: boolean;
  accounts?: Partial<Record<Network, string | null>>;
}) {
  return (
    <div className="st-cap-nets">
      <div className="st-inset">
        {STORY_NETWORKS.map((n) => (
          <div key={n} className="st-cap-net">
            <span className="st-cap-net-ic" aria-hidden="true">
              <NetGlyph network={n} size={19} />
            </span>
            <Switch
              checked={!!value[n]?.trim()}
              disabled={disabled}
              onChange={(on) => onChange({ ...value, [n]: on ? value[n]?.trim() || label : "" })}
              label={`${NETWORK_LABEL[n]} story`}
              hint={accounts ? (accounts[n] ?? "Not connected") : undefined}
            />
          </div>
        ))}
      </div>
      <p className="st-note">Stories show no text. Threads and LinkedIn have no stories, so they are skipped.</p>
    </div>
  );
}
