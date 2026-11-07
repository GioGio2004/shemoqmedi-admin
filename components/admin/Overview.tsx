"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export function Overview() {
  const counts = useQuery(api.listings.reviewCounts, {});
  const n = (value: number | undefined) => (value === undefined ? "·" : value);

  return (
    <>
      <div className="workspace-hero">
        <div>
          <p className="admin-eyebrow">01 / Overview</p>
          <h1>Control room.</h1>
        </div>
        <p className="workspace-intro">
          Sites submitted on shemoqmedi.space land in the review queue. Nothing goes public until
          you approve it.
        </p>
      </div>

      <div className="workspace-modules">
        <Link href="/review?status=pending" className="workspace-card">
          <div className="workspace-card-top">
            <p className="admin-eyebrow">Review queue</p>
            <span className="admin-arrow" aria-hidden="true">↗</span>
          </div>
          <h2>{n(counts?.pending)} waiting</h2>
          <p>Submissions that need a decision, oldest first.</p>
          <span className="workspace-card-link">Open the queue <span aria-hidden="true">→</span></span>
        </Link>
        <Link href="/review?status=approved" className="workspace-card">
          <div className="workspace-card-top">
            <p className="admin-eyebrow">Showcase</p>
            <span className="admin-arrow" aria-hidden="true">↗</span>
          </div>
          <h2>{n(counts?.approved)} live</h2>
          <p>
            Approved sites currently on the public grid. {n(counts?.rejected)} rejected so far.
          </p>
          <span className="workspace-card-link">See live sites <span aria-hidden="true">→</span></span>
        </Link>
      </div>
    </>
  );
}
