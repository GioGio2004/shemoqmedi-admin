"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PILLARS, type PillarKey } from "@/convex/lib/taxonomy";
import { AwardBadges } from "./ReviewQueue";
import { errorMessage, score, type AwardSlug } from "./format";

type Pillars = Record<PillarKey, number>;

type Props = {
  id: Id<"listings">;
  editorialScores: Pillars | null;
  editorialAverage: number | null;
  communityAverage: number | null;
  communityVotesCount: number;
  finalScore: number | null;
  awards: AwardSlug[];
  /** Scores are final once voting has closed. */
  locked: boolean;
};

function toDraft(scores: Pillars | null): Record<PillarKey, string> {
  return {
    design: scores ? String(scores.design) : "",
    usability: scores ? String(scores.usability) : "",
    creativity: scores ? String(scores.creativity) : "",
    code: scores ? String(scores.code) : "",
  };
}

/** Jury score editor (4 pillars, 1.0–10.0) plus the live score summary. */
export function ScoreEditor(props: Props) {
  const save = useMutation(api.listings.setEditorialScores);
  const [draft, setDraft] = useState(() => toDraft(props.editorialScores));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = PILLARS.map((p) => ({ key: p.key, value: Number(draft[p.key]) }));
  const valid = parsed.every(
    (p) => draft[p.key].trim() !== "" && Number.isFinite(p.value) && p.value >= 1 && p.value <= 10,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy || props.locked) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const scores = Object.fromEntries(parsed.map((p) => [p.key, p.value])) as Pillars;
      await save({ id: props.id, scores });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="score-heading">
      <p id="score-heading" className="admin-eyebrow mb-5">
        Jury score
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

      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <fieldset disabled={props.locked || busy} className="grid grid-cols-2 gap-3">
          <legend className="sr-only">Jury pillars, 1.0 to 10.0</legend>
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
                  setSaved(false);
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
        {props.locked ? (
          <p className="text-xs text-black/55">Voting has closed. These scores are final.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="admin-button" disabled={!valid || busy}>
              {busy ? "Saving…" : "Save jury score"}
            </button>
            {saved && (
              <span role="status" className="text-xs text-black/55">
                Saved.
              </span>
            )}
          </div>
        )}
        <p className="text-xs leading-relaxed text-black/55">
          Final = 0.6 × jury + 0.4 × community (jury only until someone votes).
        </p>
      </form>
    </section>
  );
}
