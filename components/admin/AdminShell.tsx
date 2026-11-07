"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { STOREFRONT_URL } from "@/lib/storefront";
import { Wordmark } from "./Wordmark";
import { useAdmin } from "./useAdmin";

function PendingCount() {
  const counts = useQuery(api.listings.reviewCounts, {});
  if (!counts || counts.pending === 0) return null;
  return (
    <span className="admin-count" aria-label={`${counts.pending} waiting`}>
      <span>{counts.pending}</span>
    </span>
  );
}

function AdminHeader() {
  const pathname = usePathname();
  const admin = useAdmin();
  const items = [
    { href: "/dashboard", label: "Overview" },
    { href: "/review", label: "Review" },
  ];

  return (
    <header className="admin-header">
      <Link href="/dashboard" className="admin-brand" aria-label="Admin home">
        <Wordmark />
        <span className="admin-brand-label">Admin</span>
      </Link>
      <nav className="admin-navigation" aria-label="Admin navigation">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname.startsWith(item.href) ? "page" : undefined}
          >
            {item.label}
            {item.href === "/review" && admin.kind === "admin" && <PendingCount />}
          </Link>
        ))}
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
