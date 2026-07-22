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
    <div className="min-h-[100dvh] bg-black text-zinc-50 font-sans">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-emerald-500/[0.07] via-transparent to-transparent"
      />

      {/* ── Top header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {isFullOrg && (
              <Link
                href="/dashboard"
                title="Back to main dashboard"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 border-t-white/20 bg-white/[0.06] text-zinc-400 backdrop-blur-xl backdrop-saturate-150 transition-[color,transform] duration-150 ease-out hover:text-white active:scale-[0.97] motion-reduce:transform-none"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10">
              <ShoppingBag className="h-4 w-4 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-none text-white">
                Surprise Bags
              </p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {organization?.name ?? "Loading…"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Desktop tabs */}
            <nav className="relative hidden items-center gap-1 overflow-hidden rounded-full border border-white/10 border-t-white/25 bg-white/[0.06] p-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-xl backdrop-saturate-150 sm:flex">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/[0.10] to-transparent"
              />
              {TABS.map((tab) => {
                const active = tab.exact
                  ? bare === tab.href
                  : bare.startsWith(tab.href);
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={cn(
                      "relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none",
                      active
                        ? "bg-white/15 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)] ring-1 ring-white/20 backdrop-blur-md backdrop-saturate-150"
                        : "text-zinc-400 hover:text-white",
                    )}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
            <UserButton
              appearance={{ elements: { avatarBox: "h-8 w-8 rounded-xl" } }}
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
        {/* Soft fade so content dissolves under the bar */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-black/60 to-transparent"
        />
        <div className="border-t border-white/10 bg-black/60 px-6 pt-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl backdrop-saturate-150">
          <div className="flex items-center justify-around">
            {TABS.map((tab) => {
              const active = tab.exact
                ? bare === tab.href
                : bare.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="group flex flex-1 flex-col items-center gap-1 py-2 transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none"
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-200 ease-out",
                      active
                        ? "bg-white/15 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)] ring-1 ring-white/20 backdrop-blur-md backdrop-saturate-150"
                        : "text-zinc-500 group-active:bg-white/10",
                    )}
                  >
                    <tab.icon className="h-5 w-5" />
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-semibold tracking-wide",
                      active ? "text-white" : "text-zinc-600",
                    )}
                  >
                    {tab.label}
                  </span>
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
