"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useOrganization, useAuth, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ShoppingBag,
  Menu,
  X,
  Store,
  Nfc,
  Bot,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { useState, createContext, useContext } from "react";

// Sidebar collapsed state shared between layout and sidebar content
const SidebarCtx = createContext(false);

const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard, exact: true },
  {
    label: "Menu",
    href: "/dashboard/menu",
    icon: UtensilsCrossed,
    exact: false,
  },
  {
    label: "Storefront",
    href: "/dashboard/storefront",
    icon: Store,
    exact: false,
  },
  {
    label: "Orders",
    href: "/dashboard/orders",
    icon: ShoppingBag,
    exact: false,
  },
  { label: "NFC", href: "/dashboard/nfc", icon: Nfc, exact: false },
  { label: "VolooAI", href: "/dashboard/ai-manager", icon: Bot, exact: false },
  {
    label: "Chat",
    href: "/dashboard/chat-theme",
    icon: MessageSquare,
    exact: false,
  },
] as const;

// ── Active path helper ─────────────────────────────────────────────────────────
function useIsActive(item: (typeof NAV_ITEMS)[number]) {
  const pathname = usePathname();
  const bare = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");
  return item.exact ? bare === item.href : bare.startsWith(item.href);
}

// ── Desktop sidebar nav link ──────────────────────────────────────────────────
function NavLink({
  item,
  onClick,
}: {
  item: (typeof NAV_ITEMS)[number];
  onClick?: () => void;
}) {
  const isActive = useIsActive(item);
  const collapsed = useContext(SidebarCtx);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
        collapsed ? "justify-center px-2" : "",
        isActive
          ? "bg-white/10 text-white"
          : "text-zinc-400 hover:bg-white/5 hover:text-white",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 h-6 w-6 items-center justify-center rounded-lg transition-colors",
          isActive
            ? "bg-white/15 text-white"
            : "bg-white/5 text-zinc-500 group-hover:bg-white/10 group-hover:text-white",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && isActive && (
        <div className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
      )}
    </Link>
  );
}

// ── Mobile bottom tab bar item ─────────────────────────────────────────────────
function BottomTab({ item }: { item: (typeof NAV_ITEMS)[number] }) {
  const isActive = useIsActive(item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="flex flex-col items-center gap-1 flex-1 py-2 relative group"
    >
      <div
        className={cn(
          "relative flex items-center justify-center w-10 h-10 rounded-2xl transition-all duration-200",
          isActive
            ? "bg-white text-black shadow-lg shadow-white/10"
            : "text-zinc-500 group-active:bg-white/8",
        )}
      >
        <Icon className="h-5 w-5" />
        {/* VolooAI active pulse */}
        {isActive && item.label === "VolooAI" && (
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
        )}
      </div>
      <span
        className={cn(
          "text-[10px] font-semibold tracking-wide transition-colors",
          isActive ? "text-white" : "text-zinc-600",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

// ── Workspace display ──────────────────────────────────────────────────────────
function WorkspaceDisplay() {
  const { organization, isLoaded } = useOrganization();
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
        <span className="text-sm font-bold text-white">
          {isLoaded && organization
            ? organization.name.charAt(0).toUpperCase()
            : "—"}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white leading-none truncate">
          {isLoaded && organization ? organization.name : "Loading…"}
        </p>
        <p className="text-[11px] text-zinc-500 mt-0.5">Active workspace</p>
      </div>
    </div>
  );
}

// ── Impersonation banner ───────────────────────────────────────────────────────
function ImpersonationBanner() {
  const { actor } = useAuth();
  if (!actor) return null;
  return (
    <div className="bg-destructive text-destructive-foreground px-4 py-2 text-center text-sm font-semibold flex items-center justify-center gap-3 z-50 shrink-0 shadow-md">
      <span className="animate-pulse h-2 w-2 rounded-full bg-white" />
      You are currently impersonating this user.
      <div className="ml-2">
        <UserButton
          appearance={{ elements: { userButtonAvatarBox: "h-6 w-6" } }}
        />
      </div>
    </div>
  );
}

// ── Sidebar content (desktop) ──────────────────────────────────────────────────
function SidebarContent({ onNavClick, allowedNavItems }: { onNavClick?: () => void, allowedNavItems: any[] }) {
  const { organization, isLoaded } = useOrganization();
  const collapsed = useContext(SidebarCtx);
  return (
    <div className="flex h-full flex-col">
      {/* Logo / brand */}
      <div
        className={cn(
          "px-4 pt-1 pb-5",
          collapsed && "px-2 flex justify-center",
        )}
      >
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 border border-white/20">
            <span className="text-sm font-bold text-white">S</span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 border border-white/20">
              <span className="text-sm font-bold text-white">S</span>
            </div>
            <div>
              <p className="text-[13px] font-medium leading-none text-white">
                Shemoqmedi
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Admin Console</p>
            </div>
          </div>
        )}
      </div>

      {/* Workspace display */}
      {!collapsed && (
        <div className="px-3 mb-4">
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-600">
            Workspace
          </p>
          <WorkspaceDisplay />
        </div>
      )}

      <div className="mx-3 mb-3 h-px bg-white/10" />

      <nav className="flex-1 px-3">
        {!collapsed && (
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-600">
            Navigation
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {allowedNavItems.map((item) => (
            <NavLink key={item.href} item={item} onClick={onNavClick} />
          ))}
        </div>
      </nav>

      {!collapsed && (
        <div className="px-4 py-4 mt-auto border-t border-white/10">
          <p className="text-[10px] text-zinc-600 text-center font-mono">
            v1.0.0
          </p>
        </div>
      )}
    </div>
  );
}

// ── Root layout ────────────────────────────────────────────────────────────────
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const isAiManager = pathname.includes("ai-manager");

  const { organization, membership, isLoaded } = useOrganization();
  const convexRole = useQuery(api.memberships.getMyRole, organization ? { orgId: organization.id } : "skip");
  const orgSettings = useQuery(api.organizations.getOrgSettings, organization ? { orgId: organization.id } : "skip");
  
  const role = convexRole || membership?.role;
  const showAiManager = orgSettings?.features?.hasAiManager !== false;
  const showNfc = orgSettings?.features?.hasNfcHardware !== false;
  const showLiveOrdering = orgSettings?.features?.hasLiveOrdering !== false;
  const showDigitalMenu = orgSettings?.features?.hasDigitalMenu !== false;

  const allowedNavItems = NAV_ITEMS.filter((item) => {
    if (!showAiManager && (item.label === "VolooAI" || item.label === "Chat")) return false;
    if (!showNfc && item.label === "NFC") return false;
    if (!showLiveOrdering && item.label === "Orders") return false;
    if (!showDigitalMenu && (item.label === "Menu" || item.label === "Storefront")) return false;

    if (!isLoaded || !role) return true;
    if (role === "org:owner" || role === "org:admin" || role === "owner") return true;
    if (role === "org:manager" || role === "manager") return true;
    if (role === "org:barista" || role === "barista") return ["Overview", "Orders", "Menu"].includes(item.label);
    if (role === "org:server" || role === "server") return ["Overview", "Orders"].includes(item.label);
    return true;
  });

  const bare = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");
  const currentNavItem = NAV_ITEMS.find(item => item.exact ? bare === item.href : bare.startsWith(item.href));
  const isAllowed = !currentNavItem || allowedNavItems.includes(currentNavItem);

  return (
    <SidebarCtx.Provider value={sidebarCollapsed}>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-black">
        <ImpersonationBanner />

        <div className="flex flex-1 overflow-hidden">
          {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
          <aside
            className={cn(
              "hidden lg:flex shrink-0 flex-col border-r border-white/10 bg-[#09090b] py-5 relative transition-all duration-300",
              sidebarCollapsed ? "w-[56px]" : "w-[220px]",
            )}
          >
            {/* Collapse toggle */}
            <button
              id="sidebar-collapse-btn"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              className="absolute -right-3 top-[72px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-[#09090b] text-zinc-500 hover:text-white shadow-md transition-colors"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronLeft className="h-3 w-3" />
              )}
            </button>
            <SidebarContent allowedNavItems={allowedNavItems} />
          </aside>

          {/* ── Mobile slide-out sidebar ─────────────────────────────────────── */}
          {mobileOpen && (
            <div
              className="fixed inset-0 z-40 lg:hidden"
              aria-modal="true"
              role="dialog"
            >
              <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={() => setMobileOpen(false)}
              />
              <aside className="absolute left-0 top-0 bottom-0 w-[220px] bg-[#09090b] border-r border-white/10 py-5 flex flex-col z-50 shadow-2xl">
                <button
                  className="absolute top-4 right-3 rounded-lg p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </button>
                <SidebarContent onNavClick={() => setMobileOpen(false)} allowedNavItems={allowedNavItems} />
              </aside>
            </div>
          )}

          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            {/* ── Top header ───────────────────────────────────────────────────── */}
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-black/80 px-4 backdrop-blur-xl">
              <button
                className="flex lg:hidden items-center justify-center rounded-lg p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                onClick={() => setMobileOpen(true)}
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="flex lg:hidden absolute left-1/2 -translate-x-1/2 items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {isAiManager
                    ? "VolooAI"
                    : (pathname
                        .split("/")
                        .pop()
                        ?.replace(/-/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase()) ??
                      "Dashboard")}
                </span>
              </div>

              <div className="hidden lg:block" />

              <div className="flex items-center gap-2.5">
                <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-2.5 py-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                  <span className="text-[11px] font-medium text-white">
                    Live
                  </span>
                </div>
                <UserButton
                  appearance={{ elements: { avatarBox: "h-8 w-8 rounded-xl" } }}
                />
              </div>
            </header>

            {/* ── Page content ─────────────────────────────────────────────────── */}
            <main
              className={cn(
                "flex-1 min-h-0",
                isAiManager ? "overflow-hidden" : "overflow-y-auto bg-black",
              )}
            >
              {isAllowed ? (
                isAiManager ? (
                  // AI Manager gets full height, no padding wrapper
                  children
                ) : (
                  <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 pb-28 lg:pb-8 bg-black min-h-full">
                    {children}
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-full pt-32 text-center px-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 mb-6">
                    <X className="h-8 w-8 text-zinc-500" />
                  </div>
                  <h2 className="text-xl font-medium text-white mb-2">Feature Disabled</h2>
                  <p className="text-zinc-400 text-sm max-w-md">
                    This module has been deactivated by the platform administrator.
                  </p>
                  <Link href="/dashboard" className="mt-8 px-4 py-2 bg-white text-black font-medium text-sm rounded-lg hover:bg-zinc-200 transition-colors">
                    Return to Overview
                  </Link>
                </div>
              )}
            </main>
          </div>
        </div>

        {/* ── Mobile bottom tab bar (PWA-first) ──────────────────────────────── */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex items-end"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="w-full border-t border-white/10 bg-black/90 backdrop-blur-xl px-2 pt-1">
            <div className="flex items-center justify-around">
              {allowedNavItems.map((item) => (
                <BottomTab key={item.href} item={item} />
              ))}
            </div>
          </div>
        </nav>
      </div>
    </SidebarCtx.Provider>
  );
}
