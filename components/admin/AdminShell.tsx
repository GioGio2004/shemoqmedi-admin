"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { STOREFRONT_URL } from "@/lib/storefront";
import { Wordmark } from "./Wordmark";
import { useAdmin } from "./useAdmin";

function CountBubble({
  value,
  label,
}: {
  value: number | undefined;
  label: string;
}) {
  if (!value) return null;
  return (
    <span className="admin-count">
      <span aria-hidden="true">{value}</span>
      <span className="sr-only">
        , {value} {label}
      </span>
    </span>
  );
}

/** Mounted only for admins, so the admin-only queries never run early. */
function ReviewCount() {
  const counts = useQuery(api.listings.reviewCounts, {});
  return <CountBubble value={counts?.pending} label="waiting" />;
}

function ClaimsCount() {
  const count = useQuery(api.claims.pendingCount, {});
  return <CountBubble value={count} label="pending claims" />;
}

function SocialCount() {
  const count = useQuery(api.social.waitingCount, {});
  return <CountBubble value={count} label="posts waiting" />;
}

const NAV = [
  { href: "/dashboard", label: "Overview", count: null },
  { href: "/review", label: "Review", count: ReviewCount },
  { href: "/social", label: "Social", count: SocialCount },
  { href: "/nominees", label: "Nominees", count: null },
  { href: "/featured", label: "Featured", count: null },
  { href: "/awards", label: "Awards", count: null },
  { href: "/listings/new", label: "Add site", count: null },
  { href: "/creators", label: "Creators", count: null },
  { href: "/jury", label: "Jury", count: null },
  { href: "/outreach", label: "Outreach", count: null },
  { href: "/design", label: "Design", count: null },
  { href: "/voiceover", label: "Voiceover", count: null },
  { href: "/users", label: "Users", count: null },
  { href: "/claims", label: "Claims", count: ClaimsCount },
  { href: "/seed", label: "Import", count: null },
] as const;

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The "all sections" button at the end of the nav, and its popup. */
function AllSections({
  pathname,
  showCounts,
}: {
  pathname: string;
  showCounts: boolean;
}) {
  // Open on the page it was opened on: navigating elsewhere closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null);
  const wrap = useRef<HTMLDivElement>(null);

  // Close on Escape or a click anywhere outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpenOn(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="admin-all">
      <button
        type="button"
        className="admin-all-button"
        aria-expanded={open}
        aria-controls="admin-all-sections"
        aria-label="All sections"
        onClick={() => setOpen(!open)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="currentColor"
        >
          {[2, 8, 14].flatMap((y) =>
            [2, 8, 14].map((x) => (
              <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />
            )),
          )}
        </svg>
      </button>
      {open && (
        <div
          id="admin-all-sections"
          className="admin-all-panel"
          role="dialog"
          aria-label="All sections"
        >
          {NAV.map((item) => {
            const Count = item.count;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={
                  isCurrent(pathname, item.href) ? "page" : undefined
                }
                onClick={() => setOpen(false)}
              >
                {item.label}
                {Count && showCounts && <Count />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminHeader() {
  const pathname = usePathname();
  const admin = useAdmin();

  return (
    <header className="admin-header">
      <Link href="/dashboard" className="admin-brand" aria-label="Admin home">
        <Wordmark />
        <span className="admin-brand-label">Admin</span>
      </Link>
      {/* Eleven items: the bar scrolls sideways (no scrollbar) when the window
          is narrow, and the button at its end lists every section at once. */}
      <div className="admin-nav-wrap">
        <nav className="admin-navigation" aria-label="Admin navigation">
          {NAV.map((item) => {
            const Count = item.count;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={
                  isCurrent(pathname, item.href) ? "page" : undefined
                }
              >
                {item.label}
                {Count && admin.kind === "admin" && <Count />}
              </Link>
            );
          })}
        </nav>
        <AllSections pathname={pathname} showCounts={admin.kind === "admin"} />
      </div>
      <div className="admin-header-actions">
        <a
          href={STOREFRONT_URL}
          className="admin-storefront-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          Storefront <span aria-hidden="true">↗</span>
        </a>
        <UserButton />
      </div>
    </header>
  );
}

/** Header + page frame. Children render only for platform admins. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const admin = useAdmin();

  return (
    <div className="flex min-h-dvh flex-col">
      <AdminHeader />
      <main className="admin-page">
        {admin.kind === "admin" ? (
          children
        ) : admin.kind === "loading" ? (
          <p className="admin-eyebrow">Loading…</p>
        ) : (
          <AccessNotice state={admin} />
        )}
      </main>
    </div>
  );
}

function AccessNotice({
  state,
}: {
  state: Exclude<ReturnType<typeof useAdmin>, { kind: "admin" | "loading" }>;
}) {
  if (state.kind === "no-session") {
    return (
      <div className="admin-empty">
        <h2>Session not accepted.</h2>
        You&apos;re signed in to Clerk, but Convex did not accept the session.
        Check the Clerk JWT template &quot;convex&quot; and
        CLERK_FRONTEND_API_URL on the Convex deployment.
      </div>
    );
  }
  if (state.kind === "not-synced") {
    return (
      <div className="admin-empty">
        <h2>Almost there.</h2>
        Your account hasn&apos;t reached the database yet. The Clerk webhook
        creates it a few seconds after sign-up. Refresh in a moment.
      </div>
    );
  }
  return (
    <div className="admin-empty">
      <h2>No access.</h2>
      This area is for platform admins. To grant access, run this in the
      shemoqmedi-admin folder:
      <code>{`npx convex run users:setRole '{"email":"${state.email}","role":"admin"}'`}</code>
    </div>
  );
}
