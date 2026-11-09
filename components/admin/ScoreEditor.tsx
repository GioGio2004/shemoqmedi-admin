"use client";

import { showError } from "./Alerts";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PILLARS, type PillarKey } from "@/convex/lib/taxonomy";
import { AwardBadges } from "./ReviewQueue";
import { score, type AwardSlug } from "./format";

type Pillars = Record<PillarKey, number>;

type Props = {
  id: Id<"listings">;
  editorialScores: Pillars | null;
  editorialAverage: number | null;
  communityAverage: number | null;
  communityVotesCount: number;
  finalScore: number | null;
  awards: AwardSlug[];
};

function toDraft(scores: Pillars | null): Record<PillarKey, string> {
  return {
    design: scores ? String(scores.design) : "",
    usability: scores ? String(scores.usability) : "",
    creativity: scores ? String(scores.creativity) : "",
    content: scores ? String(scores.content) : "",
  };
}

/**
 * Jury score editor (4 pillars, 1.0–10.0) plus the live score summary.
 * A score typed here is the admin's estimate: it shows on the site but makes
 * no site eligible for awards, which need jury votes (award settings).
 * Awards are given and revoked on the Awards page.
 */
export function ScoreEditor(props: Props) {
  const save = useMutation(api.listings.setEditorialScores);
  const clear = useMutation(api.admin.clearEditorialScores);
  const resetVotes = useMutation(api.admin.resetVotes);

  const evaluations = useQuery(api.jury.evaluationsForListing, { listingId: props.id });
  const removeEvaluation = useMutation(api.jury.deleteEvaluation);
  // With jury evaluations the jury score is their average: no manual entry.
  const fromJury = (evaluations?.length ?? 0) > 0;
  const [draft, setDraft] = useState(() => toDraft(props.editorialScores));
  const [busy, setBusy] = useState<"save" | "clear" | "votes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const parsed = PILLARS.map((p) => ({ key: p.key, value: Number(draft[p.key]) }));
  const valid = parsed.every(
    (p) => draft[p.key].trim() !== "" && Number.isFinite(p.value) && p.value >= 1 && p.value <= 10,
  );

  async function run(kind: "save" | "clear" | "votes", action: () => Promise<string>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const scores = Object.fromEntries(parsed.map((p) => [p.key, p.value])) as Pillars;
    void run("save", async () => {
      await save({ id: props.id, scores });
      return "Jury score saved.";
    });
  }

  function onClear() {
    if (!confirm("Clear the jury score? The final score falls back to the community score.")) return;
    void run("clear", async () => {
      await clear({ id: props.id });
      setDraft(toDraft(null));
      return "Jury score cleared.";
    });
  }

  function onResetVotes() {
    const n = props.communityVotesCount;
    if (
      !confirm(
        `Delete all community votes (${n} ${n === 1 ? "vote" : "votes"}) on this listing? This can't be undone.`,
      )
    ) {
      return;
    }
    void run("votes", async () => {
      const removed = await resetVotes({ id: props.id });
      return `Removed ${removed} ${removed === 1 ? "vote" : "votes"}.`;
    });
  }

  return (
    <section className="admin-panel" aria-labelledby="score-heading">
      <p id="score-heading" className="admin-eyebrow mb-5">
        Scores
      </p>

      <dl className="score-summary">
        <div>
          <dt>Jury</dt>
          <dd className="admin-mono">{score(props.editorialAverage)}</dd>
        </div>
        <div>
          <dt>Community</dt>
          <dd className="admin-mono">
            {score(props.communityAverage)}
            <span className="score-votes">
              {props.communityVotesCount} {props.communityVotesCount === 1 ? "vote" : "votes"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Final</dt>
          <dd className="admin-mono">{score(props.finalScore)}</dd>
        </div>
        <div>
          <dt>Awards</dt>
          <dd>{props.awards.length ? <AwardBadges awards={props.awards} /> : <span className="admin-mono">—</span>}</dd>
        </div>
      </dl>

      {fromJury && evaluations && (
        <div className="mt-6 grid gap-3">
          <p className="admin-eyebrow">
            Jury evaluations ({evaluations.length}), averaged into the jury score
          </p>
          <ul className="grid gap-3">
            {evaluations.map((e) => {
              // Weighted like the final score: Design 40%, Usability 30%, Creativity 20%, Content 10%.
              const avg = e.scores.design * 0.4 + e.scores.usability * 0.3 + e.scores.creativity * 0.2 + e.scores.content * 0.1;
              return (
                <li key={e.id} className="grid gap-1 rounded-2xl border border-black/10 p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{e.jurorName}</span>
                    <span className="admin-mono">{score(avg)}</span>
                  </div>
                  <p className="admin-mono text-xs text-black/55">
                    D {e.scores.design} · U {e.scores.usability} · C {e.scores.creativity} · Content {e.scores.content}
                  </p>
                  {e.comment && <p className="whitespace-pre-line text-xs text-black/70">{e.comment}</p>}
                  <button
                    type="button"
                    className="justify-self-start text-xs underline underline-offset-4"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!confirm(`Delete ${e.jurorName}'s evaluation? It is removed from the site and the jury score is recalculated.`)) return;
                      void run("clear", async () => {
                        await removeEvaluation({ evaluationId: e.id });
                        return "Evaluation deleted.";
                      });
                    }}
                  >
                    Delete evaluation
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!fromJury && (
      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <fieldset disabled={busy !== null} className="grid grid-cols-2 gap-3">
          <legend className="admin-eyebrow mb-3">Jury pillars, 1.0–10.0</legend>
          {PILLARS.map((p) => (
            <label key={p.key} className="grid gap-1.5">
              <span className="admin-eyebrow">{p.name}</span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={10}
                step={0.1}
                required
                value={draft[p.key]}
                onChange={(e) => {
                  setMessage(null);
                  setDraft((d) => ({ ...d, [p.key]: e.target.value }));
                }}
                className="admin-input admin-mono"
                placeholder="1.0–10.0"
              />
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm font-medium">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="admin-button" disabled={!valid || busy !== null}>
            {busy === "save" ? "Saving…" : "Save jury score"}
          </button>
          {props.editorialScores && (
            <button
              type="button"
              className="admin-button admin-button-secondary"
              disabled={busy !== null}
              onClick={onClear}
            >
              {busy === "clear" ? "Clearing…" : "Clear jury score"}
            </button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-black/55">
          Final = 0.6 × jury + 0.4 × community (jury only until someone votes). Changing scores after voting
          closed updates the final score but not the awards. Once a juror evaluates the site, the jury score
          becomes the average of the evaluations.
        </p>
      </form>
      )}

      <div className="mt-6 grid gap-3 border-t border-black/10 pt-6">
        <button
          type="button"
          className="admin-button admin-button-secondary w-full"
          disabled={busy !== null}
          onClick={onResetVotes}
        >
          {busy === "votes" ? "Resetting…" : "Reset community votes"}
        </button>
        {message && (
          <p role="status" className="text-xs text-black/55">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
