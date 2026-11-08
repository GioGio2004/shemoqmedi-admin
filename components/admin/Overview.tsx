"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LegacyMediaMigrator } from "./LegacyMediaMigrator";

type Card = {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  primary?: boolean;
};

function WorkspaceCard({ card }: { card: Card }) {
  return (
    <Link
      href={card.href}
      className="workspace-card"
      // The primary card keeps a solid black hairline instead of the faint one.
      style={card.primary ? { borderColor: "var(--foreground)" } : undefined}
    >
      <div className="workspace-card-top">
        <p className="admin-eyebrow">{card.eyebrow}</p>
        <span className="admin-arrow" aria-hidden="true">
          {card.primary ? "+" : "↗"}
        </span>
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
      href: "/listings/new",
      eyebrow: "Add a site",
      title: "List a site",
      body: "List a site by hand with your own screenshots: up to five screenshots and a hover video, credit, scores and lifecycle.",
      cta: "Add a site",
      primary: true,
    },
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
      href: "/creators",
      eyebrow: "Creators",
      title: "Profiles",
      body: "Rename creators, change their profile address, tier, region, bio and claimed state.",
      cta: "Manage creators",
    },
    {
      href: "/users",
      eyebrow: "Users",
      title: "Roles",
      body: "Everyone who signed up, with their listings and votes. Grant or remove admin access.",
      cta: "Manage users",
    },
    {
      href: "/claims",
      eyebrow: "Claims",
      title: `${n(claims)} pending`,
      body: "“This is mine” requests for unclaimed sites and creator profiles.",
      cta: "Review claims",
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
          Add sites by hand, or approve submissions. Live sites vote for 7 days (14 if fewer than 5
          jurors have scored them), then close with their final score and awards.
        </p>
      </div>

      <div className="workspace-modules workspace-modules-3">
        {cards.map((card) => (
          <WorkspaceCard key={card.href} card={card} />
        ))}
      </div>

      <LegacyMediaMigrator />
    </>
  );
}
