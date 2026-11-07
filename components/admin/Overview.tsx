"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type Card = {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
};

function WorkspaceCard({ card }: { card: Card }) {
  return (
    <Link href={card.href} className="workspace-card">
      <div className="workspace-card-top">
        <p className="admin-eyebrow">{card.eyebrow}</p>
        <span className="admin-arrow" aria-hidden="true">↗</span>
      </div>
      <h2>{card.title}</h2>
      <p>{card.body}</p>
      <span className="workspace-card-link">
        {card.cta} <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

export function Overview() {
  const counts = useQuery(api.listings.reviewCounts, {});
  const claims = useQuery(api.claims.pendingCount, {});
  const n = (value: number | undefined) => (value === undefined ? "·" : value);

  const cards: Card[] = [
    {
      href: "/review?status=pending",
      eyebrow: "Review queue",
      title: `${n(counts?.pending)} waiting`,
      body: "Submissions that need a decision, oldest first. Approving opens a 7-day voting window.",
      cta: "Open the queue",
    },
    {
      href: "/review?status=in_voting",
      eyebrow: "Live voting",
      title: `${n(counts?.in_voting)} live`,
      body: "Public sites collecting jury and community scores. Windows close automatically.",
      cta: "See live voting",
    },
    {
      href: "/review?status=awarded",
      eyebrow: "Awarded",
      title: `${n(counts?.awarded)} awarded`,
      body: `Closed with SOTD, BSC or HM. ${n(counts?.archived)} closed without an award, ${n(counts?.rejected)} rejected.`,
      cta: "See awarded sites",
    },
    {
      href: "/claims",
      eyebrow: "Claims",
      title: `${n(claims)} pending`,
      body: "“This is mine” requests for unclaimed sites and creator profiles.",
      cta: "Review claims",
    },
    {
      href: "/seed",
      eyebrow: "Import",
      title: "Add sites",
      body: "Load the flagship seed, or import live URLs with an automatic screenshot.",
      cta: "Open the importer",
    },
  ];

  return (
    <>
      <div className="workspace-hero">
        <div>
          <p className="admin-eyebrow">01 / Overview</p>
          <h1>Control room.</h1>
        </div>
        <p className="workspace-intro">
          Submissions wait here until you approve them. Approved sites vote for 7 days, then
          close with their final score and awards.
        </p>
      </div>

      <div className="workspace-modules workspace-modules-3">
        {cards.map((card) => (
          <WorkspaceCard key={card.href} card={card} />
        ))}
      </div>
    </>
  );
}
