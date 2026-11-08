"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useMediaUpload } from "./MediaUpload";
import { showAlert, showError } from "./Alerts";

/**
 * Overview panel: moves files that are not where new uploads go, one at a
 * time, through the same pipeline as new uploads (useMediaUpload):
 *   - files still in Convex storage (uploads from before the ImageKit
 *     switch, importer covers): screenshots → WebP on ImageKit
 *   - preview videos still on ImageKit (each new one there costs video
 *     processing units): compressed in this tab → Cloudflare R2
 * Each file is swapped in place on its listing and the old copy is
 * deleted. Hidden when there is nothing left.
 */
export function LegacyMediaMigrator() {
  const legacy = useQuery(api.media.legacyFiles, {});
  const videos = useQuery(api.media.imagekitVideos, {});
  const upload = useMediaUpload();
  const adopt = useMutation(api.media.adoptLegacy);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  if (!legacy || !videos || (legacy.length === 0 && videos.length === 0 && !progress)) return null;
  const total = legacy.reduce((n, l) => n + l.items.length, 0);

  async function run() {
    if (!legacy || !videos || progress) return;
    const jobs = [
      ...legacy.flatMap((l) => l.items.map((item) => ({ listing: l, item }))),
      ...videos.map((v) => ({
        listing: { listingId: v.listingId, slug: v.slug, title: v.title },
        item: { id: v.id, role: "video" as const, position: 0, url: v.url },
      })),
    ];
    let done = 0;
    let failed = 0;
    setProgress({ done, total: jobs.length });
    for (const { listing, item } of jobs) {
      try {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`Could not download a file of “${listing.title}”.`);
        const blob = await res.blob();
        const file = new File([blob], "original", { type: blob.type.split(";")[0] });
        const label =
          item.role === "cover" ? "cover" : item.role === "video" ? "preview" : `screenshot-${item.position}`;
        const to = await upload(file, { site: listing.slug, label });
        await adopt({ listingId: listing.listingId, from: item.id, to });
      } catch (err) {
        failed++;
        showError(err);
      }
      done++;
      setProgress({ done, total: jobs.length });
    }
    setProgress(null);
    if (failed === 0) showAlert(`Moved ${jobs.length} ${jobs.length === 1 ? "file" : "files"}.`, "success");
    else showAlert(`${jobs.length - failed} moved, ${failed} failed. Run it again to retry the rest.`);
  }

  return (
    <section className="admin-panel mt-8 flex flex-wrap items-center justify-between gap-6">
      <div className="grid gap-2">
        <p className="admin-eyebrow">Media storage</p>
        {total > 0 && (
          <p className="text-sm leading-relaxed">
            {total} {total === 1 ? "file" : "files"} across {legacy.length}{" "}
            {legacy.length === 1 ? "listing" : "listings"} still live in Convex storage. Moving them makes
            screenshots WebP on ImageKit with SEO file names; the old copies are deleted.
          </p>
        )}
        {videos.length > 0 && (
          <p className="text-sm leading-relaxed">
            {videos.length} preview {videos.length === 1 ? "video is" : "videos are"} still on ImageKit, where
            every new video costs processing units. Moving compresses each one in this tab (720p MP4) and puts it
            on Cloudflare R2; the ImageKit copy is deleted. Keep this tab open.
          </p>
        )}
      </div>
      <button type="button" className="admin-button" onClick={run} disabled={!!progress}>
        {progress ? `Moving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Move files"}
      </button>
    </section>
  );
}
