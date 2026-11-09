"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { LIMITS, PILLARS } from "@/convex/lib/taxonomy";
import { formatDate, STOREFRONT_URL, storefrontSiteUrl } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";
import { score, shortUrl } from "./format";
import { JurorAvatar } from "./JuryAdmin";

type Overview = FunctionReturnType<typeof api.jury.nomineesOverview>;
type Nominee = Overview["nominees"][number];
type Evaluation = Nominee["evaluations"][number];

const MINUTE = 60_000;

/** The current time, refreshed every minute for the countdowns. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function timeLeft(endsAt: number | null, now: number) {
  if (endsAt === null) return "No end date";
  const ms = endsAt - now;
  if (ms <= 0) return "Closing now";
  const minutes = Math.floor(ms / MINUTE);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes % 60}m left`;
  return `${Math.max(1, minutes)}m left`;
}

/** One segment per evaluation needed: filled when it has come in. */
function JuryProgress({ count, target }: { count: number; target: number }) {
  const short = Math.max(0, target - count);
  return (
    <div className="grid gap-2">
      <p className="admin-mono admin-score">
        {count} / {target}
        <span className="score-votes">jury evaluations</span>
      </p>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: target }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < count ? "bg-black" : "bg-black/10"}`} />
        ))}
      </div>
      <p className={short ? "text-xs font-medium" : "text-xs text-black/55"}>
        {short ? `Needs ${short} more` : "Target met"}
      </p>
    </div>
  );
}

function EvaluationRow({ evaluation }: { evaluation: Evaluation }) {
  const remove = useMutation(api.jury.deleteEvaluation);
  const [busy, setBusy] = useState(false);
  const { juror } = evaluation;

  async function onDelete() {
    if (busy) return;
    if (!confirm(`Delete ${juror.name}'s evaluation? It is removed from the site and the jury score is recalculated.`)) {
      return;
    }
    setBusy(true);
    try {
      await remove({ evaluationId: evaluation.id });
      showAlert("Evaluation deleted.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-3 border-t border-black/10 py-4 first:border-t-0">
      <div className="flex flex-wrap items-start gap-4">
        <JurorAvatar url={juror.imageUrl} name={juror.name} size={40} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="font-medium">
            {juror.slug ? (
              <a
                href={`${STOREFRONT_URL}/jury/${juror.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:underline"
              >
                {juror.name}
              </a>
            ) : (
              juror.name
            )}
          </p>
          {juror.title && <p className="text-sm text-black/70">{juror.title}</p>}
          <p className="admin-mono text-xs text-black/55">{formatDate(evaluation.updatedAt)}</p>
        </div>
        <p className="admin-mono admin-score">
          <span className="sr-only">Average </span>
          {score(evaluation.average)}
        </p>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {PILLARS.map((p) => (
          <div key={p.key} className="flex items-baseline gap-2">
            <dt className="text-xs text-black/55">{p.name}</dt>
            <dd className="admin-mono">{evaluation.scores[p.key]}</dd>
          </div>
        ))}
      </dl>
      {evaluation.comment && <p className="whitespace-pre-line text-sm text-black/70">{evaluation.comment}</p>}
      <button
        type="button"
        className="admin-button admin-button-secondary justify-self-start"
        disabled={busy}
        onClick={() => void onDelete()}
      >
        {busy ? "Deleting…" : "Delete evaluation"}
      </button>
    </li>
  );
}

function NomineeCard({ nominee, target, now }: { nominee: Nominee; target: number; now: number }) {
  const count = nominee.evaluations.length;

  return (
    <article className="admin-panel grid gap-6" aria-labelledby={`nominee-${nominee.id}`}>
      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)_auto] md:items-start">
        <div className="request-thumb">{nominee.coverUrl && <img src={nominee.coverUrl} alt="" />}</div>
        <div className="grid min-w-0 gap-2">
          <p className="admin-mono text-black/55">{timeLeft(nominee.votingEndsAt, now)}</p>
          <h2 id={`nominee-${nominee.id}`} className="text-2xl font-medium leading-tight">
            <Link href={`/review/${nominee.id}`} className="underline-offset-4 hover:underline">
              {nominee.title}
            </Link>
          </h2>
          <p className="text-sm text-black/70">
            {nominee.creditName} · {shortUrl(nominee.url)}
          </p>
          {(nominee.isStartup || nominee.votingExtended) && (
            <div className="flex flex-wrap items-center gap-2">
              {nominee.isStartup && <span className="admin-tag">Startup</span>}
              {nominee.votingExtended && (
                <span className="admin-status" data-status="in_voting">
                  Extended
                </span>
              )}
            </div>
          )}
          {nominee.votingExtended && (
            <p className="text-xs text-black/55">
              In its second week: fewer than {target} jurors had evaluated it when the first week ended.
            </p>
          )}
          {nominee.votingEndsAt !== null && (
            <p className="text-xs text-black/55">Voting ends {formatDate(nominee.votingEndsAt)}</p>
          )}
        </div>
        <a
          href={storefrontSiteUrl(nominee.slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="admin-button admin-button-secondary justify-self-start"
        >
          View on site <span aria-hidden="true">↗</span>
        </a>
      </div>

      <dl className="score-summary" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div>
          <dt>Jury progress</dt>
          <dd>
            <JuryProgress count={count} target={target} />
          </dd>
        </div>
        <div>
          <dt>Jury</dt>
          <dd className="admin-mono">
            {score(nominee.editorialAverage)}
            {nominee.editorialScores && (
              <span className="score-votes">
                {PILLARS.map((p) => `${p.name} ${score(nominee.editorialScores?.[p.key])}`).join(" · ")}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Community</dt>
          <dd className="admin-mono">
            {score(nominee.communityAverage)}
            <span className="score-votes">
              {nominee.communityVotesCount} {nominee.communityVotesCount === 1 ? "vote" : "votes"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Final</dt>
          <dd className="admin-mono">{score(nominee.finalScore)}</dd>
        </div>
      </dl>

      <section aria-label={`Jury scores for ${nominee.title}`} className="grid gap-2">
        <p className="admin-eyebrow">Jury scores ({count})</p>
        {count === 0 ? (
          <p className="text-sm text-black/55">No jury evaluations yet.</p>
        ) : (
          <ul>
            {nominee.evaluations.map((e) => (
              <EvaluationRow key={e.id} evaluation={e} />
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

export function Nominees() {
  const overview = useQuery(api.jury.nomineesOverview, {});
  const now = useNow();
  const target = overview?.juryTarget ?? LIMITS.juryMinEvaluations; // award setting: jury votes needed
  const nominees = overview?.nominees ?? [];
  const belowTarget = nominees.filter((n) => n.evaluations.length < target).length;

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Nominees</p>
          <h1>Nominees.</h1>
          <p>
            Every site in its voting week, soonest to close first, with its jury scores. Each site needs {target} jury
            evaluations; a site with fewer when its week ends gets one more week, then closes.
          </p>
        </div>
        <Link href="/jury" className="admin-button admin-button-secondary">
          Jury
        </Link>
      </div>

      {overview === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : (
        <div className="grid gap-6">
          <dl className="score-summary" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <div>
              <dt>In voting</dt>
              <dd className="admin-mono">{nominees.length}</dd>
            </div>
            <div>
              <dt>Active jurors</dt>
              <dd className="admin-mono">
                {overview.activeJurors}
                <span className="score-votes">target {target} per site</span>
              </dd>
            </div>
            <div>
              <dt>Below target</dt>
              <dd className="admin-mono">{belowTarget}</dd>
            </div>
            <div>
              <dt>Extended</dt>
              <dd className="admin-mono">{nominees.filter((n) => n.votingExtended).length}</dd>
            </div>
          </dl>
          <p className="text-sm text-black/70">
            Each site needs {target} jury evaluations; {overview.activeJurors} active{" "}
            {overview.activeJurors === 1 ? "juror" : "jurors"}.
            {overview.activeJurors < target && " Invite more jurors so every site can reach the target."}
          </p>

          {nominees.length === 0 ? (
            <div className="admin-empty">
              <h2>No sites in voting.</h2>
              Approve a site from Review to open its voting week.
            </div>
          ) : (
            nominees.map((n) => <NomineeCard key={n.id} nominee={n} target={target} now={now} />)
          )}
        </div>
      )}
    </>
  );
}
