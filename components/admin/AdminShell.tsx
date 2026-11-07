"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { STOREFRONT_URL } from "@/lib/storefront";
import { Wordmark } from "./Wordmark";
import { useAdmin } from "./useAdmin";

function CountBubble({ value, label }: { value: number | undefined; label: string }) {
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

const NAV = [
  { href: "/dashboard", label: "Overview", count: null },
  { href: "/review", label: "Review", count: ReviewCount },
  { href: "/listings/new", label: "Add site", count: null },
  { href: "/creators", label: "Creators", count: null },
  { href: "/users", label: "Users", count: null },
  { href: "/claims", label: "Claims", count: ClaimsCount },
  { href: "/seed", label: "Import", count: null },
] as const;

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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
      {/* Seven items: tighter padding than the base style, and the bar scrolls
          sideways instead of wrapping when the window is narrow. */}
      <nav
        className="admin-navigation"
        aria-label="Admin navigation"
        style={{ minWidth: 0, overflowX: "auto" }}
      >
        {NAV.map((item) => {
          const Count = item.count;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
              style={{ paddingInline: 14, flexShrink: 0, whiteSpace: "nowrap" }}
            >
              {item.label}
              {Count && admin.kind === "admin" && <Count />}
            </Link>
          );
        })}
      </nav>
      <div className="admin-header-actions">
        <a href={STOREFRONT_URL} className="admin-storefront-link" target="_blank" rel="noopener noreferrer">
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

function AccessNotice({ state }: { state: Exclude<ReturnType<typeof useAdmin>, { kind: "admin" | "loading" }> }) {
  if (state.kind === "no-session") {
    return (
      <div className="admin-empty">
        <h2>Session not accepted.</h2>
        You&apos;re signed in to Clerk, but Convex did not accept the session. Check the Clerk JWT
        template &quot;convex&quot; and CLERK_FRONTEND_API_URL on the Convex deployment.
      </div>
    );
  }
  if (state.kind === "not-synced") {
    return (
      <div className="admin-empty">
        <h2>Almost there.</h2>
        Your account hasn&apos;t reached the database yet. The Clerk webhook creates it a few
        seconds after sign-up. Refresh in a moment.
      </div>
    );
  }
  return (
    <div className="admin-empty">
      <h2>No access.</h2>
      This area is for platform admins. To grant access, run this in the shemoqmedi-admin folder:
      <code>{`npx convex run users:setRole '{"email":"${state.email}","role":"admin"}'`}</code>
    </div>
  );
}
