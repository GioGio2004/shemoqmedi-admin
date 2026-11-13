"use client";

import "@/app/studio/screens/reel-editor.css";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { DraftView } from "@/convex/reels";
import { errorMessage } from "@/components/admin/format";
import { probeSource } from "@/lib/reel/probe";
import { ASPECTS, defaultRecipe, isVideoKind, normalizeRecipe, type ClipSource } from "@/lib/reel/recipe";
import { clipIndexAt } from "@/lib/reel/timeline";
import {
  clipProblems,
  editorReducer,
  editorWarnings,
  formatClock,
  formatSec,
  initialEditorState,
  isConflictError,
  renderProblems,
  saveProblems,
  selectedClip,
  shouldRestore,
  timelineOf,
  type EditorState,
  type LocalCopy,
} from "@/lib/studio/reelEditor";
import { reelRenders, type RenderJobState } from "@/lib/studio/reelRender";
import { createDraftStore } from "@/lib/studio/persist";
import { useStudioTitle } from "../../chrome";
import { useMedia } from "../../hooks";
import { ChevronLeftIcon, ReelIcon } from "../../icons";
import { Segmented, Sheet, Skel } from "../../ui";
import { PreviewPlayer } from "../PreviewPlayer";
import { AudioPanel } from "./AudioPanel";
import { CaptionsPanel } from "./CaptionsPanel";
import { ClipPanel, TransitionFields } from "./ClipPanel";
import { ReelPanel } from "./ReelPanel";
import { RenderSheet } from "./RenderSheet";
import { SourcePicker } from "./SourcePicker";
import { Timeline } from "./Timeline";
import { AddClipIcon, AudioIcon, CaptionsIcon, PauseIcon, PlayIcon, RedoIcon, RenderIcon, SettingsIcon, UndoIcon } from "./icons";

// The reel editor (docs/reel-editor.md section 4): live preview on top (the
// same compositor as the final render), the timeline under it, and the
// settings of the selected clip, the sound, the captions and the reel: in a
// side pane on a computer, in sheets on a phone. Every option is Giorgi's;
// the defaults are only a start. Changes save themselves (about a second
// after the last one) and are also kept on this device until saved.

export type ReelEditorProps = {
  /** null: a new reel. */
  draftId: Id<"reelDrafts"> | null;
  /** Opened from a post: after rendering, the reel replaces media item `item` (null: is added). */
  post?: { id: Id<"socialPosts">; item: number | null } | null;
  /** Back to /reels, or to the post. */
  onClose: () => void;
};

type Panel = "clip" | "audio" | "captions" | "reel";
type SaveState = "idle" | "saving" | "error" | "conflict";

const local = createDraftStore<LocalCopy>("reel-editor");
const IDLE_JOB: RenderJobState = { running: null, stage: null };

/** The URL of this editor once its draft exists (a reload then opens the draft, not a new reel). */
function editorUrl(id: string, post: ReelEditorProps["post"]) {
  const q = new URLSearchParams({ draft: id });
  if (post) {
    q.set("post", post.id);
    if (post.item !== null) q.set("item", String(post.item));
  }
  return `/reels?${q.toString()}`;
}

export function ReelEditor({ draftId, post, onClose }: ReelEditorProps) {
  useStudioTitle("Reel editor");
  // The draft this editor created itself: when the URL then names it, the editor stays as it is.
  const [created, setCreated] = useState<string | null>(null);
  const key = draftId && draftId !== created ? draftId : "new";
  const postId = post?.id ?? null;
  const postItem = post?.item ?? null;
  const onCreated = useCallback(
    (id: string) => {
      setCreated(id);
      try {
        // null, not window.history.state: Next's own state (__NA) would skip its router sync, and the
        // router would later put the old ?new=1 address back. With null it keeps its tree and takes the URL.
        window.history.replaceState(null, "", editorUrl(id, postId ? { id: postId, item: postItem } : null));
      } catch {
        // The URL is a convenience.
      }
    },
    [postId, postItem],
  );
  return <Loader key={key} draftId={key === "new" ? null : (draftId as Id<"reelDrafts">)} post={post ?? null} onClose={onClose} onCreated={onCreated} />;
}

function Loader({ draftId, post, onClose, onCreated }: { draftId: Id<"reelDrafts"> | null; post: ReelEditorProps["post"]; onClose: () => void; onCreated: (id: string) => void }) {
  const draft = useQuery(api.reels.get, draftId ? { id: draftId } : "skip");
  if (draftId && draft === undefined) {
    return (
      <div className="st-re" aria-busy="true">
        <div className="st-re-bar">
          <Skel style={{ width: 44, height: 44, borderRadius: 22 }} />
          <Skel className="st-skel-text" style={{ width: 160 }} />
        </div>
        <Skel className="st-re-skel-screen" />
        <Skel style={{ height: 96, borderRadius: 18 }} />
      </div>
    );
  }
  if (draftId && draft === null) {
    return (
      <div className="st-empty st-in">
        <strong>This reel draft is gone.</strong>It was deleted. Its rendered reel and posts stay.
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={onClose}>
          Back to Reels
        </button>
      </div>
    );
  }
  return <Editor initial={draft ?? null} post={post} onClose={onClose} onCreated={onCreated} />;
}

/**
 * The first state: the draft (or an empty reel), with this device's unsaved
 * copy put back when it was made from this version. A copy made from an older
 * version is never dropped silently: it comes back as `orphan`, and Giorgi
 * chooses (load the newer version, or keep his).
 */
function startState(draft: DraftView | null): { state: EditorState; notice: string | null; orphan: LocalCopy | null } {
  let state = draft ? editorReducer(initialEditorState(defaultRecipe()), { type: "load", draft }) : initialEditorState(defaultRecipe());
  const copy = local.get(draft?.id ?? "new");
  if (!copy) return { state, notice: null, orphan: null };
  if (shouldRestore(copy, draft)) {
    try {
      state = editorReducer(state, { type: "restore", recipe: normalizeRecipe(copy.recipe), title: copy.title });
      return { state, notice: "Your unsaved changes from this device are back.", orphan: null };
    } catch {
      return { state, notice: null, orphan: null };
    }
  }
  return { state, notice: null, orphan: draft ? copy : null };
}

function Editor({ initial, post, onClose, onCreated }: { initial: DraftView | null; post: ReelEditorProps["post"]; onClose: () => void; onCreated: (id: string) => void }) {
  const [start] = useState(() => startState(initial));
  const [state, dispatch] = useReducer(editorReducer, start.state);
  const [notice, setNotice] = useState(start.notice);
  /** Unsaved changes on this device made from an older version: kept until Giorgi chooses. */
  const [orphan, setOrphan] = useState<LocalCopy | null>(start.orphan);
  const [leaving, setLeaving] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const desk = useMedia("(min-width: 900px)");
  const [tab, setTab] = useState<Panel>("clip");
  const [sheet, setSheet] = useState<Panel | null>(null);
  const [picker, setPicker] = useState<"add" | "quick" | null>(null);
  const [transFor, setTransFor] = useState<string | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const job = useSyncExternalStore(reelRenders.subscribe, reelRenders.get, () => IDLE_JOB);

  const create = useMutation(api.reels.create);
  const update = useMutation(api.reels.update);
  const live = useQuery(api.reels.get, state.draftId ? { id: state.draftId } : "skip");

  const { recipe } = state;
  const timeline = timelineOf(recipe);
  const problems = useMemo(() => saveProblems({ recipe }), [recipe]);
  const forRender = useMemo(() => renderProblems({ recipe }), [recipe]);
  const warnings = useMemo(() => editorWarnings({ recipe }), [recipe]);
  const clip = selectedClip(state);
  const clipIndex = clip ? recipe.clips.indexOf(clip) : -1;
  const selectedId = state.selected;
  const problemsOfClip = useMemo(
    () => clipProblems(problems, recipe.clips.findIndex((c) => c.id === selectedId)),
    [problems, recipe, selectedId],
  );
  const current = clipIndexAt(timeline, state.time);
  const jobKey = state.draftId ?? "new";

  // ── Saving ────────────────────────────────────────────────────────────────
  const stateRef = useRef(state);
  const sentRef = useRef<{ recipe: EditorState["recipe"]; title: string } | null>(initial ? { recipe: state.recipe, title: state.title } : null);
  const serverRef = useRef<{ id: Id<"reelDrafts">; updatedAt: number } | null>(initial ? { id: initial.id, updatedAt: initial.updatedAt } : null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    stateRef.current = state;
  });

  const postId = post?.id;
  const doSave = useCallback(
    async (forceBase?: number): Promise<{ id: Id<"reelDrafts">; updatedAt: number }> => {
      const s = stateRef.current;
      const server = serverRef.current;
      const id = s.draftId ?? server?.id ?? null;
      const base = forceBase ?? Math.max(s.baseUpdatedAt ?? 0, server?.updatedAt ?? 0);
      const sent = { recipe: s.recipe, title: s.title };
      const unchanged = sentRef.current && sentRef.current.recipe === s.recipe && sentRef.current.title === s.title;
      if (id && (!s.dirty || unchanged) && forceBase === undefined) return { id, updatedAt: base };
      const errors = saveProblems(s);
      if (errors.length) throw new Error(errors[0]);
      setSaveState("saving");
      setSaveError(null);
      try {
        const title = s.title.trim() || undefined;
        if (!id) {
          const d = await create({ recipe: s.recipe, title, postId });
          serverRef.current = { id: d.id, updatedAt: d.updatedAt };
          sentRef.current = { recipe: sent.recipe, title: sent.title || d.title };
          dispatch({ type: "created", draft: d, sent });
          // The device copy moves to the draft's id (the effect below writes it there).
          local.set("new", null);
          reelRenders.adopt("new", d.id);
          onCreated(d.id);
          setSaveState("idle");
          return { id: d.id, updatedAt: d.updatedAt };
        }
        const d = await update({ id, recipe: s.recipe, title, baseUpdatedAt: base || undefined });
        serverRef.current = { id: d.id, updatedAt: d.updatedAt };
        sentRef.current = sent;
        dispatch({ type: "saved", draft: d, sent });
        setSaveState("idle");
        return { id: d.id, updatedAt: d.updatedAt };
      } catch (err) {
        const message = errorMessage(err);
        if (isConflictError(message)) setSaveState("conflict");
        else {
          setSaveState("error");
          setSaveError(message);
        }
        throw err;
      }
    },
    [create, update, postId, onCreated],
  );

  /** Saves now (after any save in flight); the draft id and its updatedAt. */
  const save = useCallback(
    (forceBase?: number) => {
      const run = chain.current.then(
        () => doSave(forceBase),
        () => doSave(forceBase),
      );
      chain.current = run.catch(() => {});
      return run;
    },
    [doSave],
  );

  // A newer version on the server (Claude changed it, or another device). Read while rendering:
  // with nothing unsaved here it simply loads; with unsaved changes it asks.
  const [seenLive, setSeenLive] = useState<number | null>(initial?.updatedAt ?? null);
  const newer = !!live && live.updatedAt !== seenLive && state.baseUpdatedAt !== null && live.updatedAt > state.baseUpdatedAt && saveState !== "saving";
  if (live && live.updatedAt !== seenLive && saveState !== "saving") {
    setSeenLive(live.updatedAt);
    if (newer && !state.dirty) dispatch({ type: "load", draft: live });
  }
  const conflict = saveState === "conflict" || (!!live && state.dirty && state.baseUpdatedAt !== null && live.updatedAt > state.baseUpdatedAt && saveState !== "saving");

  // Autosave about a second after the last change (when the server would take it).
  useEffect(() => {
    if (!state.dirty || conflict || problems.length) return;
    const t = window.setTimeout(() => void save().catch(() => {}), 1000);
    return () => window.clearTimeout(t);
  }, [state.recipe, state.title, state.dirty, conflict, problems.length, save]);

  // Unsaved work stays on this device until the server has it (an older copy waiting for a choice is left alone).
  useEffect(() => {
    if (orphan) return;
    const k = state.draftId ?? "new";
    if (state.dirty) local.set(k, { recipe: state.recipe, title: state.title, baseUpdatedAt: state.baseUpdatedAt, draftId: state.draftId, at: Date.now() });
    else local.set(k, null);
  }, [state.recipe, state.title, state.dirty, state.draftId, state.baseUpdatedAt, orphan]);

  function keepOrphan() {
    const copy = orphan;
    if (!copy) return;
    setOrphan(null);
    try {
      // Put back on top of the newer version: it saves over it (Undo goes back to the newer one).
      dispatch({ type: "restore", recipe: normalizeRecipe(copy.recipe), title: copy.title });
    } catch {
      setNotice("Those changes can't be read any more.");
    }
  }
  function dropOrphan() {
    local.set(state.draftId ?? "new", null);
    setOrphan(null);
  }

  // ── Sources: real lengths and sizes ──────────────────────────────────────
  const probed = useRef(new Set<string>());
  useEffect(() => {
    for (const c of recipe.clips) {
      const url = c.source.url;
      if (probed.current.has(`${c.id}|${url}`)) continue;
      const video = isVideoKind(c.source.kind);
      if (!video && c.source.width && c.source.height) continue;
      probed.current.add(`${c.id}|${url}`);
      probeSource(url).then(
        (p) => {
          dispatch({ type: "probed", id: c.id, sourceSec: p.durationSec ?? 0, width: p.width, height: p.height });
          setBroken((b) => {
            if (!b.has(url)) return b;
            const next = new Set(b);
            next.delete(url);
            return next;
          });
        },
        () => setBroken((b) => (b.has(url) ? b : new Set(b).add(url))),
      );
    }
  }, [recipe.clips]);

  // ── Keyboard (computer): space plays, ⌘Z / ⌘⇧Z undo and redo ─────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest("input, textarea, select, [contenteditable='true']");
      if (document.querySelector("dialog[open]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (e.key === " " && !typing && !t?.closest("button, a, [role='slider']")) {
        e.preventDefault();
        dispatch({ type: stateRef.current.playing ? "pause" : "play" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────
  const open = useCallback(
    (p: Panel) => {
      if (desk) setTab(p);
      else setSheet(p);
    },
    [desk],
  );
  const selectClip = useCallback(
    (id: string) => {
      dispatch({ type: "pause" });
      dispatch({ type: "select", id });
      const item = timelineOf(stateRef.current.recipe).items.find((i) => i.id === id);
      if (item) dispatch({ type: "seek", time: Math.min(item.end, item.start + item.transIn + 0.01) });
    },
    [],
  );
  const openClip = useCallback(
    (id: string) => {
      selectClip(id);
      open("clip");
    },
    [selectClip, open],
  );
  const moveClip = useCallback((id: string, to: number) => dispatch({ type: "moveClip", id, to }), []);
  const duplicateClip = useCallback((id: string) => dispatch({ type: "duplicateClip", id }), []);
  const removeClip = useCallback((id: string) => dispatch({ type: "removeClip", id }), []);
  const openTransition = useCallback((id: string) => setTransFor(id), []);
  const openPicker = useCallback(() => setPicker("add"), []);
  const onTime = useCallback((t: number) => dispatch({ type: "seek", time: t }), []);
  const onPlayingChange = useCallback((p: boolean) => dispatch({ type: p ? "play" : "pause" }), []);
  const openAudio = useCallback(() => open("audio"), [open]);
  const playFrom = useCallback((t: number) => {
    dispatch({ type: "seek", time: t });
    dispatch({ type: "play" });
  }, []);

  const addSources = useCallback(
    (sources: ClipSource[]) => {
      const quick = picker === "quick";
      const s = stateRef.current;
      const sel = s.recipe.clips.findIndex((c) => c.id === s.selected);
      dispatch({ type: "addClips", sources, at: sel >= 0 && !quick ? sel + 1 : s.recipe.clips.length });
      if (quick) open("audio");
    },
    [picker, open],
  );
  const closePicker = useCallback(() => setPicker(null), []);
  const closeRender = useCallback(() => setRenderOpen(false), []);

  async function close() {
    if (state.dirty && !problems.length && !conflict && saveState !== "error") {
      try {
        await save();
        onClose();
        return;
      } catch {
        // Not saved: ask below.
      }
    }
    if (stateRef.current.dirty) {
      setLeaveError(null);
      setLeaving(true);
      return;
    }
    onClose();
  }

  /** Leaving with unsaved changes: save mine (over a newer version too), then go. */
  async function saveAndLeave() {
    setLeaveBusy(true);
    setLeaveError(null);
    try {
      await save(conflict && live ? live.updatedAt : undefined);
      setLeaving(false);
      onClose();
    } catch (err) {
      setLeaveError(errorMessage(err));
    } finally {
      setLeaveBusy(false);
    }
  }
  function discardAndLeave() {
    local.set(state.draftId ?? "new", null);
    setLeaving(false);
    onClose();
  }
  function keepOnDeviceAndLeave() {
    setLeaving(false);
    onClose();
  }

  const status =
    saveState === "saving"
      ? "Saving…"
      : conflict
        ? "Changed elsewhere"
        : saveState === "error"
          ? "Not saved"
          : state.dirty && problems.length
            ? `Not saved: ${problems.length === 1 ? "1 problem" : `${problems.length} problems`}`
            : state.dirty
              ? "Unsaved"
              : state.draftId
                ? "Saved"
                : "New reel";

  const { width: W, height: H } = ASPECTS[recipe.reel.aspect];
  const transClip = transFor ? recipe.clips.find((c) => c.id === transFor) : null;
  const transIndex = transClip ? recipe.clips.indexOf(transClip) : -1;
  const rendering = job.running !== null && job.running === state.draftId;
  const draftStatus = live ?? initial;

  const panelFor = (p: Panel, compact: boolean) => {
    switch (p) {
      case "clip":
        return clip ? (
          <ClipPanel
            clip={clip}
            index={clipIndex}
            transInSec={timeline.items[clipIndex]?.transIn ?? 0}
            problems={problemsOfClip}
            broken={broken.has(clip.source.url)}
            dispatch={dispatch}
            compact={compact}
          />
        ) : (
          <div className="st-re-panel">
            <p className="st-note">Pick a clip in the timeline to change it.</p>
          </div>
        );
      case "audio":
        return <AudioPanel recipe={recipe} dispatch={dispatch} />;
      case "captions":
        return <CaptionsPanel recipe={recipe} dispatch={dispatch} onPlayFrom={playFrom} onOpenAudio={openAudio} />;
      case "reel":
        return <ReelPanel recipe={recipe} title={state.title} dispatch={dispatch} />;
    }
  };

  const SHEET_TITLE: Record<Panel, string> = { clip: clip ? `Clip ${clipIndex + 1}` : "Clip", audio: "Sound", captions: "Captions", reel: "Reel settings" };

  return (
    <div className="st-re st-in" data-desk={desk || undefined}>
      <header className="st-re-bar">
        <button type="button" className="st-icon-btn" onClick={close} aria-label={post ? "Back to the post" : "Back to Reels"}>
          <ChevronLeftIcon size={22} />
        </button>
        <div className="st-re-bar-title">
          <h1 className="st-re-title" data-large-title="">
            {state.title || "New reel"}
          </h1>
          <p className="st-note st-tnum" aria-live="polite">
            {status}
          </p>
        </div>
        <button type="button" className="st-icon-btn" aria-label="Undo" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })}>
          <UndoIcon size={20} />
        </button>
        <button type="button" className="st-icon-btn" aria-label="Redo" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })}>
          <RedoIcon size={20} />
        </button>
        <button type="button" className="st-btn st-btn-sm st-re-render" onClick={() => setRenderOpen(true)} disabled={!recipe.clips.length}>
          <RenderIcon size={18} />
          <span className="st-tnum">{rendering ? `${Math.round((job.stage?.fraction ?? 0) * 100)}%` : "Render"}</span>
        </button>
      </header>

      {notice && (
        <div className="st-callout st-re-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="st-link" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      )}
      {orphan && (
        <div className="st-callout st-re-notice" data-tone="error" role="alert">
          <span>This reel changed somewhere else after your last unsaved changes on this device.</span>
          <span className="st-row">
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={dropOrphan}>
              Load the newer version
            </button>
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={keepOrphan}>
              Keep mine
            </button>
          </span>
        </div>
      )}
      {draftStatus?.status === "ready" && !state.dirty && (
        <div className="st-callout st-re-notice" data-tone="ink" role="status">
          <span>
            <strong>Ready to render.</strong> {draftStatus.createdBy === "claude" ? "Claude made this reel. Check it, change what you like, then render." : "Check it, then render."}
            {draftStatus.note ? ` ${draftStatus.note}` : ""}
          </span>
        </div>
      )}
      {conflict && live && (
        <div className="st-callout st-re-notice" data-tone="error" role="alert">
          <span>This reel changed somewhere else since you opened it.</span>
          <span className="st-row">
            <button
              type="button"
              className="st-btn st-btn-ghost st-btn-sm"
              onClick={() => {
                dispatch({ type: "load", draft: live });
                setSaveState("idle");
              }}
            >
              Load the newer version
            </button>
            <button
              type="button"
              className="st-btn st-btn-ghost st-btn-sm"
              onClick={() => {
                setSaveState("idle");
                void save(live.updatedAt).catch(() => {});
              }}
            >
              Keep mine
            </button>
          </span>
        </div>
      )}
      {saveState === "error" && saveError && (
        <div className="st-callout st-re-notice" data-tone="error" role="alert">
          <span>Not saved: {saveError}</span>
          <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => void save().catch(() => {})}>
            Try again
          </button>
        </div>
      )}

      <div className="st-re-body">
        <div className="st-re-main">
          <div className="st-re-screen" style={{ "--ar": `${W} / ${H}`, "--arn": W / H } as React.CSSProperties}>
            {recipe.clips.length ? (
              <PreviewPlayer recipe={recipe} time={state.time} playing={state.playing} onTime={onTime} onPlayingChange={onPlayingChange} className="st-re-player" />
            ) : (
              <div className="st-re-start">
                <ReelIcon size={30} />
                <p>Start with clips: listing videos, screenshots, graphics or your own files.</p>
                <button type="button" className="st-btn st-btn-sm" onClick={() => setPicker("add")}>
                  <AddClipIcon size={18} />
                  Add clips
                </button>
                <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setPicker("quick")}>
                  Quick reel: one listing and a voice
                </button>
              </div>
            )}
          </div>

          {recipe.clips.length > 0 && (
            <div className="st-re-transport">
              <button
                type="button"
                className="st-icon-btn st-re-play round"
                aria-label={state.playing ? "Pause" : "Play"}
                onClick={() => {
                  if (!state.playing && state.time >= timeline.durationSec - 0.05) dispatch({ type: "seek", time: 0 });
                  dispatch({ type: state.playing ? "pause" : "play" });
                }}
              >
                {state.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
              </button>
              <input
                className="st-re-range st-re-scrub"
                type="range"
                min={0}
                max={Math.max(0.01, timeline.durationSec)}
                step={1 / 30}
                value={Math.min(state.time, timeline.durationSec)}
                aria-label="Playhead"
                aria-valuetext={`${formatClock(state.time)} of ${formatClock(timeline.durationSec)}`}
                style={{ "--fill": timeline.durationSec > 0 ? state.time / timeline.durationSec : 0 } as React.CSSProperties}
                onChange={(e) => {
                  dispatch({ type: "pause" });
                  dispatch({ type: "seek", time: Number(e.target.value) });
                }}
              />
              <span className="st-re-clock st-tnum">
                {formatClock(state.time)} / {formatClock(timeline.durationSec)}
              </span>
            </div>
          )}

          <div className="st-re-tools" role="toolbar" aria-label="Reel">
            <button type="button" className="st-chip st-chip-sm" onClick={() => setPicker("add")}>
              <AddClipIcon size={18} />
              Add
            </button>
            <button type="button" className="st-chip st-chip-sm" aria-pressed={desk ? tab === "audio" : undefined} onClick={() => open("audio")}>
              <AudioIcon size={18} />
              Sound
              {(recipe.audio.voice || recipe.audio.music) && <small>{[recipe.audio.voice && "voice", recipe.audio.music && "music"].filter(Boolean).join(" + ")}</small>}
            </button>
            <button type="button" className="st-chip st-chip-sm" aria-pressed={desk ? tab === "captions" : undefined} onClick={() => open("captions")}>
              <CaptionsIcon size={18} />
              Captions
              {recipe.audio.voice?.captions.on && recipe.audio.voice.captions.lines.length > 0 && <small>on</small>}
            </button>
            <button type="button" className="st-chip st-chip-sm" aria-pressed={desk ? tab === "reel" : undefined} onClick={() => open("reel")}>
              <SettingsIcon size={18} />
              {recipe.reel.aspect}
            </button>
          </div>

          <Timeline
            recipe={recipe}
            selected={state.selected}
            current={current}
            broken={broken}
            onSelect={selectClip}
            onOpen={openClip}
            onMove={moveClip}
            onDuplicate={duplicateClip}
            onRemove={removeClip}
            onTransition={openTransition}
            onAdd={openPicker}
          />

          {(problems.length > 0 || forRender.length > 0 || warnings.length > 0) && recipe.clips.length > 0 && (
            <div className="st-re-notes" aria-live="polite">
              {(problems.length ? problems : forRender).slice(0, 4).map((p) => (
                <p key={p} className="st-note st-danger-text">
                  {p}
                </p>
              ))}
              {warnings.map((w) => (
                <p key={w} className="st-note">
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>

        {desk && (
          <aside className="st-re-side st-glass" aria-label="Settings">
            <Segmented
              label="Settings for"
              block
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: "clip", label: "Clip", id: "re-tab-clip", controls: "re-side-panel" },
                { value: "audio", label: "Sound", id: "re-tab-audio", controls: "re-side-panel" },
                { value: "captions", label: "Captions", id: "re-tab-captions", controls: "re-side-panel" },
                { value: "reel", label: "Reel", id: "re-tab-reel", controls: "re-side-panel" },
              ]}
            />
            <div id="re-side-panel" role="tabpanel" aria-labelledby={`re-tab-${tab}`} className="st-re-side-in">
              {panelFor(tab, false)}
            </div>
          </aside>
        )}
      </div>

      {!desk && (
        <Sheet
          open={sheet !== null}
          onClose={() => setSheet(null)}
          title={sheet ? SHEET_TITLE[sheet] : ""}
          size="large"
          detents
          footer={
            sheet === "clip" && clip ? (
              <>
                <button type="button" className="st-btn st-btn-ghost" onClick={() => dispatch({ type: "duplicateClip", id: clip.id })}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className="st-btn st-btn-ghost st-btn-danger"
                  onClick={() => {
                    dispatch({ type: "removeClip", id: clip.id });
                    setSheet(null);
                  }}
                >
                  Delete
                </button>
              </>
            ) : undefined
          }
        >
          {sheet && panelFor(sheet, true)}
        </Sheet>
      )}

      <Sheet open={!!transClip} onClose={() => setTransFor(null)} title={transIndex > 0 ? `Into clip ${transIndex + 1}` : "Transition"} subtitle="How this clip comes in">
        {transClip && (
          <TransitionFields
            value={transClip.transitionIn}
            first={transIndex === 0}
            effectiveSec={timeline.items[transIndex]?.transIn}
            onChange={(t) => dispatch({ type: "updateClip", id: transClip.id, patch: { transitionIn: { ...transClip.transitionIn, ...t } } })}
          />
        )}
      </Sheet>

      <SourcePicker open={picker !== null} quick={picker === "quick"} onClose={closePicker} onAdd={addSources} />

      <RenderSheet
        open={renderOpen}
        onClose={closeRender}
        recipe={recipe}
        title={state.title}
        jobKey={jobKey}
        problems={forRender}
        ensureSaved={save}
        post={post}
      />

      <Sheet
        open={leaving}
        onClose={() => !leaveBusy && setLeaving(false)}
        title="Unsaved changes"
        subtitle={conflict ? "This reel changed somewhere else too." : problems.length ? "They can't be saved yet." : "They didn't save."}
        footer={
          <>
            <button type="button" className="st-btn st-btn-ghost" onClick={() => setLeaving(false)} disabled={leaveBusy}>
              Stay
            </button>
            <button type="button" className="st-btn st-btn-ghost st-btn-danger" onClick={discardAndLeave} disabled={leaveBusy}>
              Discard
            </button>
            {problems.length ? (
              <button type="button" className="st-btn" onClick={keepOnDeviceAndLeave}>
                Keep on this device
              </button>
            ) : (
              <button type="button" className="st-btn" onClick={() => void saveAndLeave()} disabled={leaveBusy} data-busy={leaveBusy}>
                {conflict ? "Keep mine and save" : "Save"}
              </button>
            )}
          </>
        }
      >
        <p className="st-note">
          {problems.length
            ? `${problems[0]} Fix it to save, or keep the changes on this device: they come back when you open this reel again.`
            : conflict
              ? "Keep mine saves your version over the newer one. Discard loads the newer one next time."
              : `${saveError ?? "The last save failed."} Try to save again, or discard your changes.`}
        </p>
        {leaveError && (
          <p className="st-callout" data-tone="error" role="alert">
            {leaveError}
          </p>
        )}
      </Sheet>

      <p className="st-note st-re-foot st-tnum">
        {formatSec(timeline.durationSec)} · {recipe.clips.length} {recipe.clips.length === 1 ? "clip" : "clips"} · {W}×{H}
      </p>
    </div>
  );
}
