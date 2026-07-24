"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  useOrganization,
  useOrganizationList,
  useAuth,
  UserButton,
} from "@clerk/nextjs";
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
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Gift,
} from "lucide-react";
import { useState, createContext, useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import { NoWorkspace } from "./_components/NoWorkspace";

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
  {
    label: "Chat",
    href: "/dashboard/chat-theme",
    icon: MessageSquare,
    exact: false,
  },
  {
    label: "Surprise Bags",
    href: "/bags-dashboard",
    icon: Gift,
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
        "v-t-micro v-press group flex items-center gap-3 rounded-v px-3 py-2.5 transition-colors",
        collapsed ? "justify-center px-2" : "",
        isActive
          ? "text-v-accent"
          : "text-v-mut hover:bg-white/[0.04] hover:text-v-ink",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          isActive
            ? "text-v-accent"
            : "text-v-faint group-hover:text-v-ink",
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && isActive && (
        <div className="ml-auto h-1 w-1 shrink-0 rounded-full bg-v-accent" />
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
      className="v-press group relative flex min-w-0 flex-1 flex-col items-center gap-1 py-2"
    >
      <div
        className={cn(
          "relative flex h-9 w-9 items-center justify-center transition-colors",
          isActive
            ? "text-v-accent"
            : "text-v-faint group-active:text-v-mut",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <span
        className={cn(
          "max-w-full truncate font-v-mono text-[9px] uppercase tracking-[0.06em] transition-colors",
          isActive ? "text-v-accent" : "text-v-faint",
        )}
      >
        {item.label}
      </span>
      <span
        className={cn(
          "h-1 w-1 rounded-full",
          isActive ? "bg-v-accent" : "bg-transparent",
        )}
      />
    </Link>
  );
}

// ── Workspace display ──────────────────────────────────────────────────────────
function WorkspaceDisplay() {
  const { organization, isLoaded } = useOrganization();
  return (
    <div className="flex items-center gap-3 rounded-v border border-v-line bg-v-bg-raise px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-v border border-v-line bg-white/[0.04]">
        <span className="font-v-mono text-sm font-medium text-v-ink">
          {isLoaded && organization
            ? organization.name.charAt(0).toUpperCase()
            : "—"}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-none text-v-ink">
          {isLoaded && organization ? organization.name : "Loading…"}
        </p>
        <p className="v-t-micro mt-0.5 text-v-faint">Active workspace</p>
      </div>
    </div>
  );
}

// ── Impersonation banner ───────────────────────────────────────────────────────
function ImpersonationBanner() {
  const { actor } = useAuth();
  if (!actor) return null;
  return (
    <div className="z-50 flex shrink-0 items-center justify-center gap-3 border-b border-red-400/40 bg-red-500/10 px-4 py-2 text-center text-sm font-medium text-red-300">
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
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
function SidebarContent({
  onNavClick,
  allowedNavItems,
}: {
  onNavClick?: () => void;
  allowedNavItems: any[];
}) {
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
          <div className="flex h-8 w-8 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
            <span className="font-v-mono text-sm font-medium text-v-ink">S</span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
              <span className="font-v-mono text-sm font-medium text-v-ink">
                S
              </span>
            </div>
            <div>
              <p className="font-v-display text-[13px] font-medium leading-none text-v-ink">
                Shemoqmedi
              </p>
              <p className="v-t-micro mt-0.5 text-v-faint">Admin Console</p>
            </div>
          </div>
        )}
      </div>

      {/* Workspace display */}
      {!collapsed && (
        <div className="px-3 mb-4">
          <p className="v-t-micro mb-2 px-1 text-v-faint">Workspace</p>
          <WorkspaceDisplay />
        </div>
      )}

      <div className="v-hairline mx-3 mb-3" />

      <nav className="flex-1 px-3">
        {!collapsed && (
          <p className="v-t-micro mb-2 px-1 text-v-faint">Navigation</p>
        )}
        <div className="flex flex-col gap-0.5">
          {allowedNavItems.map((item) => (
            <NavLink key={item.href} item={item} onClick={onNavClick} />
          ))}
        </div>
      </nav>

      {!collapsed && (
        <div className="px-4 py-4 mt-auto border-t border-v-line">
          <p className="v-t-micro text-center text-v-faint">v1.0.0</p>
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

  const { organization, membership, isLoaded } = useOrganization();
  const convexRole = useQuery(
    api.memberships.getMyRole,
    organization ? { orgId: organization.id } : "skip",
  );
  const orgSettings = useQuery(
    api.organizations.getOrgSettings,
    organization ? { orgId: organization.id } : "skip",
  );

  // ── Surprise Bags gating ─────────────────────────────────────────────────
  // "bags"-only orgs are redirected to the isolated Surprise Bags dashboard.
  const router = useRouter();
  const gating = useQuery(
    api.bagsDashboard.getOrgGating,
    organization ? { orgId: organization.id } : "skip",
  );
  const isBagsOnly = gating?.onboardingType === "bags";
  useEffect(() => {
    if (isBagsOnly) router.replace("/bags-dashboard");
  }, [isBagsOnly, router]);

  // ── Org-less guard ───────────────────────────────────────────────────────
  // The venue portal is invitation-only. A signed-in user with zero org
  // memberships (and no platform-level admin role) would otherwise land on a
  // dead-end dashboard shell, so we show the NoWorkspace screen instead.
  // Membership truth comes from Clerk (same source the active org comes
  // from); the platform role comes from the existing Convex users record.
  const { isLoaded: membershipsLoaded, userMemberships } = useOrganizationList({
    userMemberships: true,
  });
  const currentUser = useQuery(api.users.getCurrentUser);
  const isPlatformAdmin =
    currentUser?.role === "super_admin" || currentUser?.role === "admin";

  // Every signal must settle before deciding — never flash NoWorkspace at a
  // legitimate member, and never flash the dashboard at an org-less visitor.
  const orgAccessResolved =
    isLoaded &&
    membershipsLoaded &&
    !userMemberships.isLoading &&
    currentUser !== undefined;
  const showNoWorkspace =
    orgAccessResolved &&
    !organization &&
    !userMemberships.isError && // fail open on network errors
    userMemberships.count === 0 &&
    !isPlatformAdmin;
  const orgAccessPending = isLoaded && !organization && !orgAccessResolved;

  const role = convexRole || membership?.role;
  const showAiManager = orgSettings?.features?.hasAiManager !== false;
  const showLiveOrdering = orgSettings?.features?.hasLiveOrdering !== false;
  const showDigitalMenu = orgSettings?.features?.hasDigitalMenu !== false;

  const showSurpriseBags = orgSettings?.features?.hasSurpriseBags !== false;

  const allowedNavItems = NAV_ITEMS.filter((item) => {
    if (!showSurpriseBags && item.label === "Surprise Bags") return false;
    if (!showAiManager && item.label === "Chat") return false;
    if (!showLiveOrdering && item.label === "Orders") return false;
    if (
      !showDigitalMenu &&
      (item.label === "Menu" || item.label === "Storefront")
    )
      return false;

    if (!isLoaded || !role) return true;
    if (role === "org:owner" || role === "org:admin" || role === "owner")
      return true;
    if (role === "org:manager" || role === "manager") return true;
    if (role === "org:barista" || role === "barista")
      return ["Overview", "Orders", "Menu"].includes(item.label);
    if (role === "org:server" || role === "server")
      return ["Overview", "Orders"].includes(item.label);
    return true;
  });

  const bare = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");
  const currentNavItem = NAV_ITEMS.find((item) =>
    item.exact ? bare === item.href : bare.startsWith(item.href),
  );
  const isAllowed = !currentNavItem || allowedNavItems.includes(currentNavItem);

  // Org-less user (no membership, not a platform admin): replace the entire
  // dashboard chrome with the invitation-only explainer.
  if (showNoWorkspace) {
    return (
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-v-bg">
        <ImpersonationBanner />
        <NoWorkspace />
      </div>
    );
  }

  // Clerk is loaded but there is no active org and membership/role signals
  // are still in flight — hold a neutral screen so neither the dashboard nor
  // NoWorkspace flashes at the wrong audience.
  if (orgAccessPending) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-v-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-v-line border-t-v-accent" />
      </div>
    );
  }

  return (
    <SidebarCtx.Provider value={sidebarCollapsed}>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-v-bg text-v-ink">
        <ImpersonationBanner />

        <div className="flex flex-1 overflow-hidden">
          {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
          <aside
            className={cn(
              "hidden lg:flex shrink-0 flex-col border-r border-v-line bg-v-bg py-5 relative transition-all duration-300",
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
              className="absolute -right-3 top-[72px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-v-line bg-v-bg text-v-faint transition-colors hover:text-v-ink"
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
                className="absolute inset-0 bg-black/70"
                onClick={() => setMobileOpen(false)}
              />
              <aside className="absolute left-0 top-0 bottom-0 w-[220px] bg-v-bg border-r border-v-line py-5 flex flex-col z-50">
                <button
                  className="absolute top-4 right-3 rounded-v p-1.5 text-v-faint hover:text-v-ink hover:bg-white/[0.04] transition-colors"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </button>
                <SidebarContent
                  onNavClick={() => setMobileOpen(false)}
                  allowedNavItems={allowedNavItems}
                />
              </aside>
            </div>
          )}

          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            {/* ── Top header ───────────────────────────────────────────────────── */}
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-v-line bg-v-bg px-4">
              <button
                className="flex lg:hidden items-center justify-center rounded-v p-1.5 text-v-mut hover:text-v-ink hover:bg-white/[0.04] transition-colors"
                onClick={() => setMobileOpen(true)}
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="flex lg:hidden absolute left-1/2 -translate-x-1/2 items-center gap-2">
                <span className="v-t-micro text-v-ink">
                  {pathname
                    .split("/")
                    .pop()
                    ?.replace(/-/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Dashboard"}
                </span>
              </div>

              <div className="hidden lg:block" />

              <div className="flex items-center gap-2.5">
                <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-v-line px-2.5 py-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-v-accent opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-v-accent" />
                  </span>
                  <span className="v-t-micro text-v-mut">Live</span>
                </div>
                <UserButton
                  appearance={{
                    elements: { avatarBox: "h-8 w-8 rounded-none" },
                  }}
                />
              </div>
            </header>

            {/* ── Page content ─────────────────────────────────────────────────── */}
            <main className="flex-1 min-h-0 overflow-y-auto bg-v-bg">
              {isAllowed ? (
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 pb-28 lg:pb-8 bg-v-bg min-h-full">
                  {children}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full pt-32 text-center px-4">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
                    <X className="h-8 w-8 text-v-faint" />
                  </div>
                  <h2 className="mb-2 font-v-display text-xl font-medium text-v-ink">
                    Feature Disabled
                  </h2>
                  <p className="max-w-md text-sm text-v-mut">
                    This module has been deactivated by the platform
                    administrator.
                  </p>
                  <Link
                    href="/dashboard"
                    className="v-press mt-8 rounded-v bg-v-accent px-4 py-2 text-sm font-semibold text-v-accent-ink transition-[filter] hover:brightness-95"
                  >
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
          <div className="w-full border-t border-v-line bg-v-bg px-2 pt-1">
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
