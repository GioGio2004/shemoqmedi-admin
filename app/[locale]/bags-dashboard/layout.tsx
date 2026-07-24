"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOrganization, UserButton } from "@clerk/nextjs";
import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { ShoppingBag, ClipboardList, ArrowLeft } from "lucide-react";
import { Toaster } from "sonner";

const TABS = [
  { label: "Bags", href: "/bags-dashboard", icon: ShoppingBag, exact: true },
  {
    label: "Orders",
    href: "/bags-dashboard/orders",
    icon: ClipboardList,
    exact: false,
  },
] as const;

function useBarePath() {
  const pathname = usePathname();
  return pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");
}

export default function BagsDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const bare = useBarePath();
  const { organization } = useOrganization();
  const { isAuthenticated } = useConvexAuth();
  const gating = useQuery(
    api.bagsDashboard.getOrgGating,
    isAuthenticated && organization ? { orgId: organization.id } : "skip",
  );
  const isFullOrg = gating?.onboardingType === "full";

  return (
    <div className="min-h-[100dvh] bg-v-bg text-v-ink font-sans">
      {/* ── Top header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-v-line bg-v-bg">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {isFullOrg && (
              <Link
                href="/dashboard"
                title="Back to main dashboard"
                className="v-press flex h-8 w-8 shrink-0 items-center justify-center rounded-v border border-v-line text-v-mut transition-colors hover:text-v-ink"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
              <ShoppingBag className="h-4 w-4 text-v-accent" />
            </div>
            <div className="min-w-0">
              <p className="v-t-micro truncate text-v-ink">Surprise Bags</p>
              <p className="v-t-micro mt-0.5 truncate text-v-faint">
                {organization?.name ?? "Loading…"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Desktop tabs */}
            <nav className="hidden items-center divide-x divide-v-line overflow-hidden rounded-v border border-v-line sm:flex">
              {TABS.map((tab) => {
                const active = tab.exact
                  ? bare === tab.href
                  : bare.startsWith(tab.href);
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={cn(
                      "v-t-micro v-press flex items-center gap-1.5 px-4 py-2 transition-colors",
                      active
                        ? "bg-white/[0.04] text-v-accent"
                        : "text-v-mut hover:text-v-ink",
                    )}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
            <UserButton
              appearance={{ elements: { avatarBox: "h-8 w-8 rounded-none" } }}
            />
          </div>
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────────────── */}
      <main className="relative mx-auto max-w-4xl px-4 pb-28 pt-6 sm:pb-12">
        {children}
      </main>

      {/* ── Mobile bottom tabs ─────────────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="border-t border-v-line bg-v-bg px-6 pt-1">
          <div className="flex items-center justify-around">
            {TABS.map((tab) => {
              const active = tab.exact
                ? bare === tab.href
                : bare.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="v-press group flex flex-1 flex-col items-center gap-1 py-2"
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center transition-colors",
                      active
                        ? "text-v-accent"
                        : "text-v-faint group-active:text-v-mut",
                    )}
                  >
                    <tab.icon className="h-5 w-5" />
                  </div>
                  <span
                    className={cn(
                      "v-t-micro",
                      active ? "text-v-accent" : "text-v-faint",
                    )}
                  >
                    {tab.label}
                  </span>
                  <span
                    className={cn(
                      "h-1 w-1 rounded-full",
                      active ? "bg-v-accent" : "bg-transparent",
                    )}
                  />
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <Toaster position="top-center" theme="dark" richColors />
    </div>
  );
}
