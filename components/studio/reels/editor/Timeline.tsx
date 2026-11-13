"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { ReelRecipe } from "@/lib/reel/recipe";
import { isVideoClip } from "@/lib/reel/recipe";
import { formatSec, timelineOf } from "@/lib/studio/reelEditor";
import { PlusIcon, TrashIcon } from "../../icons";
import { ClipThumb } from "./ClipThumb";
import { DuplicateIcon, EditIcon, MoveLeftIcon, MoveRightIcon } from "./icons";
import { TRANSITION_SHORT } from "./fields";

// The timeline: the clips in order as cards (picture, length), the
// transition into each clip as a chip between cards (tap to change), and an
// "Add" card at the end. Reorder by dragging a card (mouse: press and move;
// touch: hold, then move) or with the move buttons under the strip. The card
// playing now is marked.

type Props = {
  recipe: ReelRecipe;
  selected: string | null;
  /** The clip on screen at the playhead (-1: none). */
  current: number;
  /** URLs that failed to load. */
  broken: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMove: (id: string, to: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onTransition: (id: string) => void;
  onAdd: () => void;
};

type Drag = {
  id: string;
  from: number;
  pointer: number;
  x0: number;
  y0: number;
  active: boolean;
  touch: boolean;
  timer: number;
  to: number;
  dx: number;
  activate: () => void;
};

const HOLD_MS = 280;

export const Timeline = memo(function Timeline({ recipe, selected, current, broken, onSelect, onOpen, onMove, onDuplicate, onRemove, onTransition, onAdd }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<{ id: string; to: number; dx: number } | null>(null);
  const suppressClick = useRef(false);
  const timeline = timelineOf(recipe);
  const clips = recipe.clips;
  const selIndex = clips.findIndex((c) => c.id === selected);
  const sel = selIndex >= 0 ? clips[selIndex] : null;

  // While a touch drag is on, the strip must not scroll (pointer events would be cancelled).
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (drag.current?.active) e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  // Keep the selected card in view: scroll the strip sideways only.
  // (scrollIntoView would also scroll the page, hiding the editor's header on open.)
  useEffect(() => {
    const s = strip.current;
    const card = selected ? cards.current.get(selected) : null;
    if (!s || !card) return;
    const sr = s.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const pad = 12;
    let left = s.scrollLeft;
    if (cr.left < sr.left + pad) left += cr.left - sr.left - pad;
    else if (cr.right > sr.right - pad) left += cr.right - sr.right + pad;
    else return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    s.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }, [selected]);

  function targetIndex(clientX: number) {
    // How many of the other cards the pointer is past (their middles; they don't move while dragging).
    let to = 0;
    for (const c of clips) {
      if (c.id === drag.current?.id) continue;
      const r = cards.current.get(c.id)?.getBoundingClientRect();
      if (r && clientX > r.left + r.width / 2) to++;
    }
    return Math.max(0, Math.min(clips.length - 1, to));
  }

  function start(e: React.PointerEvent<HTMLDivElement>, id: string, index: number) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as Element).closest("[data-no-drag]")) return;
    const touch = e.pointerType !== "mouse";
    const el = e.currentTarget;
    const d: Drag = { id, from: index, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, touch, timer: 0, to: index, dx: 0, activate: () => {} };
    drag.current = d;
    suppressClick.current = false;
    d.activate = () => {
      if (drag.current !== d) return;
      d.active = true;
      suppressClick.current = true;
      try {
        el.setPointerCapture(d.pointer);
      } catch {
        // Capture is a nicety.
      }
      if (touch && "vibrate" in navigator) navigator.vibrate?.(8);
      setDragging({ id, to: index, dx: 0 });
    };
    if (touch) d.timer = window.setTimeout(d.activate, HOLD_MS);
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (d.touch) {
        // Moved before the hold: it's a scroll.
        if (Math.hypot(dx, dy) > 8) {
          window.clearTimeout(d.timer);
          drag.current = null;
        }
        return;
      }
      if (Math.abs(dx) < 6) return;
      d.activate();
    }
    d.dx = dx;
    d.to = targetIndex(e.clientX);
    // Scroll the strip when the card nears an edge.
    const s = strip.current;
    if (s) {
      const r = s.getBoundingClientRect();
      if (e.clientX < r.left + 40) s.scrollLeft -= 12;
      else if (e.clientX > r.right - 40) s.scrollLeft += 12;
    }
    setDragging({ id: d.id, to: d.to, dx });
  }

  function end(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    window.clearTimeout(d.timer);
    drag.current = null;
    if (d.active) {
      setDragging(null);
      if (d.to !== d.from) onMove(d.id, d.to);
    }
  }

  function cancel() {
    const d = drag.current;
    if (d) window.clearTimeout(d.timer);
    drag.current = null;
    setDragging(null);
  }

  return (
    <div className="st-re-timeline">
      <div className="st-re-strip-head">
        <p className="st-label">
          <span>Timeline</span>
          <span className="st-tnum" aria-live="polite">
            {clips.length} {clips.length === 1 ? "clip" : "clips"} · {formatSec(timeline.durationSec)}
          </span>
        </p>
      </div>
      <div ref={strip} className="st-re-strip" data-no-sheet-drag="" role="list" aria-label="Clips in order" data-dragging={dragging ? "true" : undefined}>
        {clips.map((c, i) => {
          const item = timeline.items[i];
          const isDrag = dragging?.id === c.id;
          const from = dragging ? clips.findIndex((x) => x.id === dragging.id) : -1;
          const before = dragging && !isDrag && dragging.to === i && i < from;
          const after = dragging && !isDrag && dragging.to === i && i > from;
          return (
            <div key={c.id} className="st-re-slot" role="listitem" data-drop={before ? "before" : after ? "after" : undefined}>
              {i > 0 && (
                <button
                  type="button"
                  className="st-re-trans"
                  data-cut={c.transitionIn.type === "cut" || undefined}
                  onClick={() => onTransition(c.id)}
                  aria-label={`Transition into clip ${i + 1}: ${TRANSITION_SHORT[c.transitionIn.type]}${c.transitionIn.type === "cut" ? "" : `, ${c.transitionIn.durationSec} s`}. Change`}
                >
                  <span>{TRANSITION_SHORT[c.transitionIn.type]}</span>
                  {c.transitionIn.type !== "cut" && <small className="st-tnum">{item.transIn.toFixed(1)}</small>}
                </button>
              )}
              <div
                ref={(el) => {
                  if (el) cards.current.set(c.id, el);
                  else cards.current.delete(c.id);
                }}
                className="st-re-card"
                data-selected={c.id === selected || undefined}
                data-current={i === current || undefined}
                data-drag={isDrag || undefined}
                style={isDrag ? ({ "--dx": `${dragging.dx}px` } as React.CSSProperties) : undefined}
                onPointerDown={(e) => start(e, c.id, i)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={cancel}
                onContextMenu={(e) => {
                  if (drag.current) e.preventDefault();
                }}
              >
                <button
                  type="button"
                  className="st-re-card-btn"
                  aria-pressed={c.id === selected}
                  aria-label={`Clip ${i + 1}: ${c.source.label ?? (isVideoClip(c) ? "Video" : "Picture")}, ${item.length.toFixed(1)} seconds${c.id === selected ? ". Selected, tap to edit" : ""}`}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    if (c.id === selected) onOpen(c.id);
                    else onSelect(c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.altKey && e.key === "ArrowLeft" && i > 0) {
                      e.preventDefault();
                      onMove(c.id, i - 1);
                    } else if (e.altKey && e.key === "ArrowRight" && i < clips.length - 1) {
                      e.preventDefault();
                      onMove(c.id, i + 1);
                    }
                  }}
                >
                  <span className="st-re-thumb">
                    <ClipThumb source={c.source} sec={isVideoClip(c) ? c.inSec : 0} width={180} />
                  </span>
                  <span className="st-re-card-meta">
                    <b className="st-tnum">{i + 1}</b>
                    <span className="st-tnum">{item.length.toFixed(1)} s</span>
                  </span>
                  {(c.text.on && c.text.text.trim()) || broken.has(c.source.url) ? (
                    <span className="st-re-card-flags">
                      {broken.has(c.source.url) ? <span className="st-mchip">Can&apos;t load</span> : <span className="st-mchip">Aa</span>}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
          );
        })}
        <div className="st-re-slot" role="listitem">
          <button type="button" className="st-re-card st-re-add lq" onClick={onAdd} aria-label="Add clips">
            <PlusIcon size={22} />
            <span>Add</span>
          </button>
        </div>
      </div>
      {clips.length > 1 && <p className="st-note st-re-hint">Hold and drag a clip to move it. Tap a selected clip to edit it.</p>}

      {sel && (
        <div className="st-re-clipbar" role="toolbar" aria-label={`Clip ${selIndex + 1}`}>
          <button type="button" className="st-btn st-btn-sm st-re-edit" onClick={() => onOpen(sel.id)}>
            <EditIcon size={18} />
            Edit clip {selIndex + 1}
          </button>
          <button type="button" className="st-icon-btn" aria-label="Move earlier" disabled={selIndex === 0} onClick={() => onMove(sel.id, selIndex - 1)}>
            <MoveLeftIcon size={20} />
          </button>
          <button type="button" className="st-icon-btn" aria-label="Move later" disabled={selIndex === clips.length - 1} onClick={() => onMove(sel.id, selIndex + 1)}>
            <MoveRightIcon size={20} />
          </button>
          <button type="button" className="st-icon-btn" aria-label="Duplicate" onClick={() => onDuplicate(sel.id)}>
            <DuplicateIcon size={20} />
          </button>
          <button type="button" className="st-icon-btn" aria-label="Delete clip" onClick={() => onRemove(sel.id)}>
            <TrashIcon size={20} />
          </button>
        </div>
      )}
    </div>
  );
});
