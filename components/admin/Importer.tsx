"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  CATEGORIES,
  CREATOR_TIERS,
  LIMITS,
  REGIONS,
  TECHNOLOGIES,
  type CreatorTier,
  type RegionSlug,
} from "@/convex/lib/taxonomy";
import { errorMessage, safeHref, shortUrl } from "./format";

type ImportResult = FunctionReturnType<typeof api.importer.importUrls>[number];

/** Where an imported row went, so the result can link to it. */
type Destination = "pending" | "public";

function Results({
  title,
  results,
  destination,
}: {
  title: string;
  results: ImportResult[];
  destination: Destination;
}) {
  const ok = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;

  return (
    <div className="mt-6" role="status">
      <p className="admin-eyebrow mb-3">
        {title}: {ok} added · {skipped} skipped · {failed} failed
      </p>
      <ul className="import-results">
        {results.map((r) => (
          <li key={r.url}>
            <span className="import-result-state" data-state={!r.ok ? "error" : r.skipped ? "skipped" : "ok"}>
              {!r.ok ? "Error" : r.skipped ? "Skipped" : "OK"}
            </span>
            <div className="min-w-0">
              <p className="import-result-url">{shortUrl(r.url)}</p>
              <p className="import-result-note">
                {!r.ok
                  ? r.error ?? "Unknown error."
                  : r.skipped
                    ? "Already listed; nothing changed."
                    : destination === "public"
                      ? "Live in voting."
                      : "Waiting in the review queue."}
              </p>
            </div>
            {r.ok && r.id && (
              <Link href={`/review/${r.id}`} className="admin-text-link">
                Open →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImportPanel() {
  const importUrls = useAction(api.importer.importUrls);

  const [urlsText, setUrlsText] = useState("");
  const [creditName, setCreditName] = useState("");
  const [creditUrl, setCreditUrl] = useState("");
  const [tier, setTier] = useState<CreatorTier>("agency");
  const [region, setRegion] = useState<RegionSlug>("global");
  const [category, setCategory] = useState<string>(CATEGORIES[0].slug);
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [publishNow, setPublishNow] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [lastDestination, setLastDestination] = useState<Destination>("pending");

  const urls = [...new Set(urlsText.split(/\r?\n/).map((u) => u.trim()).filter(Boolean))];
  const tooMany = urls.length > LIMITS.importBatch;
  const creditHref = creditUrl.trim() ? safeHref(creditUrl.trim()) : null;
  const creditUrlInvalid = creditUrl.trim() !== "" && creditHref === null;
  const canSubmit =
    urls.length > 0 && !tooMany && creditName.trim() !== "" && !creditUrlInvalid && !busy;

  function toggleTech(name: string) {
    setTechnologies((list) =>
      list.includes(name)
        ? list.filter((t) => t !== name)
        : list.length >= LIMITS.technologies
          ? list
          : [...list, name],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setResults(null);
    const destination: Destination = publishNow ? "public" : "pending";
    try {
      const out = await importUrls({
        urls,
        category,
        technologies,
        region,
        creatorTier: tier,
        creditName: creditName.trim(),
        creditUrl: creditHref ? creditUrl.trim() : undefined,
        publishNow,
      });
      setLastDestination(destination);
      setResults(out);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="import-heading">
      <p className="admin-eyebrow">URL importer</p>
      <h2 id="import-heading" className="mt-4 text-3xl font-medium">Import live websites.</h2>
      <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-black/55">
        Each URL gets a 1600×1000 screenshot, title and description from Microlink. Captures take
        about 5–15 s each. The free tier allows ~50 captures a day; set{" "}
        <code>MICROLINK_API_KEY</code> on the Convex deployment to raise it.
        Imported sites are unclaimed and carry no scores or awards.
      </p>

      <form onSubmit={onSubmit} className="mt-8 grid gap-6">
        <fieldset disabled={busy} className="grid gap-6">
          <label className="grid gap-2">
            <span className="admin-eyebrow">
              URLs, one per line (max {LIMITS.importBatch})
            </span>
            <textarea
              rows={5}
              required
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              placeholder={"https://example.com\nhttps://another.example"}
              className="admin-input resize-y"
              aria-describedby="url-count"
            />
            <span id="url-count" className={`text-xs ${tooMany ? "font-medium" : "text-black/55"}`}>
              {urls.length} {urls.length === 1 ? "URL" : "URLs"}
              {tooMany ? ` — remove ${urls.length - LIMITS.importBatch} to continue.` : ""}
            </span>
          </label>

          <div className="grid gap-6 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="admin-eyebrow">Made by (credit / creator name)</span>
              <input
                required
                maxLength={LIMITS.creditName}
                value={creditName}
                onChange={(e) => setCreditName(e.target.value)}
                className="admin-input"
                placeholder="e.g. Bürocratik"
              />
            </label>
            <label className="grid gap-2">
              <span className="admin-eyebrow">Creator website (optional)</span>
              <input
                type="url"
                value={creditUrl}
                onChange={(e) => setCreditUrl(e.target.value)}
                className="admin-input"
                placeholder="https://studio.example"
                aria-invalid={creditUrlInvalid || undefined}
                aria-describedby={creditUrlInvalid ? "credit-url-error" : undefined}
              />
              {creditUrlInvalid && (
                <span id="credit-url-error" className="text-xs font-medium">
                  Use a full http:// or https:// address.
                </span>
              )}
            </label>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <fieldset className="grid gap-2">
              <legend className="admin-eyebrow mb-2">Creator tier</legend>
              <div className="flex flex-wrap gap-2">
                {CREATOR_TIERS.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    className="admin-toggle"
                    aria-pressed={tier === t.slug}
                    onClick={() => setTier(t.slug)}
                  >
                    {t.badge}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="admin-eyebrow mb-2">Region</legend>
              <div className="flex flex-wrap gap-2">
                {REGIONS.map((r) => (
                  <button
                    key={r.slug}
                    type="button"
                    className="admin-toggle"
                    aria-pressed={region === r.slug}
                    onClick={() => setRegion(r.slug)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-2">
              <span className="admin-eyebrow">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="admin-input">
                {CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="admin-eyebrow mb-3">
              Technologies {technologies.length}/{LIMITS.technologies}
            </legend>
            <div className="flex flex-wrap gap-2">
              {TECHNOLOGIES.map((t) => {
                const on = technologies.includes(t.name);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    className="admin-toggle admin-toggle-mono"
                    aria-pressed={on}
                    disabled={!on && technologies.length >= LIMITS.technologies}
                    onClick={() => toggleTech(t.name)}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="admin-check">
            <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
            <span>
              Publish straight into live voting
              <small>Otherwise the sites wait in the review queue.</small>
            </span>
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="admin-button" disabled={!canSubmit}>
            {busy
              ? `Importing ${urls.length} ${urls.length === 1 ? "site" : "sites"}…`
              : `Import ${urls.length || ""} ${urls.length === 1 ? "site" : "sites"}`.replace(/\s+/g, " ")}
          </button>
          {busy && (
            <span className="text-xs text-black/55">
              About {urls.length * 5}–{urls.length * 15} s. Keep this tab open.
            </span>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium">
          {error}
        </p>
      )}
      {results && <Results title="Import" results={results} destination={lastDestination} />}
    </section>
  );
}

export function Importer() {
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Import</p>
          <h1>Quick import.</h1>
          <p>
            Automatic screenshots often miss WebGL and intro-animation sites. For those, use{" "}
            <Link href="/listings/new" className="underline underline-offset-4">
              Add a site
            </Link>{" "}
            with your own screenshots.
          </p>
        </div>
        <Link href="/listings/new" className="admin-button">
          Add a site <span aria-hidden="true">→</span>
        </Link>
      </div>
      <ImportPanel />
    </>
  );
}
