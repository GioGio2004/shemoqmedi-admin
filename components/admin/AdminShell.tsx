"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { STOREFRONT_URL } from "@/lib/storefront";
import { STUDIO_ORIGIN } from "@/lib/hosts";
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

// Social, Design and Voiceover moved to the Studio (its own host and app);
// the old addresses redirect there (proxy.ts, lib/studioRouting.ts).
const NAV = [
  { href: "/dashboard", label: "Overview", count: null },
  { href: "/review", label: "Review", count: ReviewCount },
  { href: "/nominees", label: "Nominees", count: null },
  { href: "/featured", label: "Featured", count: null },
  { href: "/awards", label: "Awards", count: null },
  { href: "/listings/new", label: "Add site", count: null },
  { href: "/creators", label: "Creators", count: null },
  { href: "/jury", label: "Jury", count: null },
  { href: "/outreach", label: "Outreach", count: null },
  { href: "/users", label: "Users", count: null },
  { href: "/claims", label: "Claims", count: ClaimsCount },
  { href: "/seed", label: "Import", count: null },
  { href: "/settings", label: "Settings", count: null },
] as const;

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const noSubscribe = () => () => {};

/** The Studio's address from here: studio.localhost next to a local admin, else production. */
function studioOriginHere() {
  const { hostname, port } = window.location;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return local ? `http://studio.localhost${port ? `:${port}` : ""}` : STUDIO_ORIGIN;
}

function useStudioOrigin() {
  return useSyncExternalStore(noSubscribe, studioOriginHere, () => STUDIO_ORIGIN);
}

/** The Studio (social queue, design, reels) opens as its own app in a new tab, with the waiting posts count. */
function StudioLink({
  className,
  showCounts,
  onNavigate,
}: {
  className?: string;
  showCounts: boolean;
  onNavigate?: () => void;
}) {
  const studio = useStudioOrigin();
  return (
    <a href={studio} className={className} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
      Studio <span aria-hidden="true">↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
      {showCounts && <SocialCount />}
    </a>
  );
}

/** Every admin section as links (and the Studio): the desktop popup and the mobile "More" sheet. */
function SectionLinks({
  pathname,
  showCounts,
  onNavigate,
}: {
  pathname: string;
  showCounts: boolean;
  onNavigate: () => void;
}) {
  return (
    <>
      {NAV.map((item) => {
        const Count = item.count;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            onClick={onNavigate}
          >
            {item.label}
            {Count && showCounts && <Count />}
          </Link>
        );
      })}
      <StudioLink showCounts={showCounts} onNavigate={onNavigate} />
    </>
  );
}

/**
 * Open/closed state for a menu that belongs to the page it was opened on:
 * navigating elsewhere closes it. Escape and a press outside `wrap` close it too.
 */
function usePageMenu(pathname: string) {
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const wrap = useRef<HTMLDivElement>(null);

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

  return { open, wrap, setOpen: (v: boolean) => setOpenOn(v ? pathname : null) };
}

/** The "all sections" button at the end of the desktop nav, and its popup. */
function AllSections({
  pathname,
  showCounts,
}: {
  pathname: string;
  showCounts: boolean;
}) {
  const { open, wrap, setOpen } = usePageMenu(pathname);

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
        <DotsIcon />
      </button>
      {open && (
        <div
          id="admin-all-sections"
          className="admin-all-panel"
          role="dialog"
          aria-label="All sections"
        >
          <SectionLinks pathname={pathname} showCounts={showCounts} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function DotsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      {[2, 8, 14].flatMap((y) =>
        [2, 8, 14].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />),
      )}
    </svg>
  );
}

/**
 * Phones (under 900px): a bottom tab bar instead of the header nav, within
 * thumb reach. "More" opens every section as a sheet; Studio opens the
 * Studio app in a new tab.
 */
function MobileTabBar({
  pathname,
  showCounts,
}: {
  pathname: string;
  showCounts: boolean;
}) {
  const { open, wrap, setOpen } = usePageMenu(pathname);
  const tab = (href: string) => (isCurrent(pathname, href) ? "page" : undefined);
  const studio = useStudioOrigin();

  // The page under the open sheet doesn't scroll (globals.css .admin-sheet-open).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("admin-sheet-open");
    return () => root.classList.remove("admin-sheet-open");
  }, [open]);

  return (
    <div ref={wrap} className="admin-tabbar-wrap">
      {open && (
        // A real layer over the page: a tap on the dimmed area lands here and only closes the
        // sheet, never reaching the link or button underneath. Inside `wrap`, so the
        // outside-press listener leaves it alone.
        <div className="admin-sheet-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
      )}
      {open && (
        <div id="admin-more-sheet" className="admin-sheet" role="dialog" aria-label="All sections">
          <p className="admin-eyebrow">All sections</p>
          <div className="admin-sheet-links">
            <SectionLinks pathname={pathname} showCounts={showCounts} onNavigate={() => setOpen(false)} />
            <a href={STOREFRONT_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
              Storefront <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      )}
      <nav className="admin-tabbar" aria-label="Admin sections">
        <Link href="/dashboard" aria-current={tab("/dashboard")}>
          <TabIcon d="M3 10.5 10 4l7 6.5V17h-4.5v-4h-5v4H3z" />
          Overview
        </Link>
        <Link href="/review" aria-current={tab("/review")}>
          <TabIcon d="M4 4h12v12H4zM7 8h6M7 11h6M7 14h3" />
          Review
          {showCounts && <ReviewCount />}
        </Link>
        <a href={studio} target="_blank" rel="noopener noreferrer">
          <TabIcon d="M5 15 15 5M8 5h7v7" />
          Studio
          <span className="sr-only"> (opens in a new tab)</span>
          {showCounts && <SocialCount />}
        </a>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-more-sheet"
          onClick={() => setOpen(!open)}
        >
          <TabIcon d="M4 6h12M4 10h12M4 14h12" />
          More
        </button>
      </nav>
    </div>
  );
}

function TabIcon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
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
      {/* Thirteen items: the bar scrolls sideways (no scrollbar) when the window
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
        <StudioLink className="admin-storefront-link" showCounts={admin.kind === "admin"} />
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

/** Header + page frame (+ the tab bar on phones). Children render only for platform admins. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const admin = useAdmin();
  const pathname = usePathname();

  return (
    <div className="admin-shell flex min-h-dvh flex-col">
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
      <MobileTabBar pathname={pathname} showCounts={admin.kind === "admin"} />
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
