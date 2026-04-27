"use client";

import { usePathname } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, UtensilsCrossed, ShoppingBag,
  Wifi, Settings, Menu, X,
} from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
  { label: "Overview",  href: "/dashboard",          icon: LayoutDashboard, exact: true  },
  { label: "Menu",      href: "/dashboard/menu",     icon: UtensilsCrossed, exact: false },
  { label: "Orders",    href: "/dashboard/orders",   icon: ShoppingBag,     exact: false },
  { label: "Fleet",     href: "/dashboard/fleet",    icon: Wifi,            exact: false },
  { label: "Settings",  href: "/dashboard/settings", icon: Settings,        exact: false },
] as const;

function NavLink({ item, onClick }: { item: (typeof NAV_ITEMS)[number]; onClick?: () => void }) {
  const pathname = usePathname();
  const bare = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");
  const isActive = item.exact ? bare === item.href : bare.startsWith(item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
        isActive
          ? "bg-primary/12 text-primary shadow-[inset_0_0_0_1px_oklch(0.718_0.195_53.4_/_0.2)]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <div className={cn(
        "flex h-6 w-6 items-center justify-center rounded-lg transition-colors",
        isActive ? "bg-primary/20 text-primary" : "bg-accent group-hover:bg-primary/10 text-muted-foreground group-hover:text-primary"
      )}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      {item.label}
      {isActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
    </Link>
  );
}

function WorkspaceDisplay() {
  const { organization, isLoaded } = useOrganization();
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card border border-border px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
        <span className="text-sm font-bold text-primary">
          {isLoaded && organization ? organization.name.charAt(0).toUpperCase() : "—"}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground leading-none truncate">
          {isLoaded && organization ? organization.name : "Loading…"}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Active workspace</p>
      </div>
    </div>
  );
}

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-1 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <span className="text-sm font-black text-primary">S</span>
          </div>
          <div>
            <p className="text-[13px] font-bold leading-none text-foreground">Shemoqmedi</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">Admin Console</p>
          </div>
        </div>
      </div>

      <div className="px-3 mb-4">
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">Workspace</p>
        <WorkspaceDisplay />
      </div>

      <div className="mx-3 mb-3 h-px bg-border" />

      <nav className="flex-1 px-3">
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">Navigation</p>
        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} onClick={onNavClick} />
          ))}
        </div>
      </nav>

      <div className="px-4 py-4 mt-auto border-t border-border">
        <p className="text-[10px] text-muted-foreground/40 text-center font-mono">v1.0.0</p>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar py-5">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" aria-modal="true" role="dialog">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-[220px] bg-sidebar border-r border-border py-5 flex flex-col z-50 shadow-2xl">
            <button
              className="absolute top-4 right-3 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => setMobileOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent onNavClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar/40 px-4 backdrop-blur-sm">
          <button
            className="flex lg:hidden items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[11px] font-semibold text-emerald-400">Live</span>
            </div>
            <UserButton appearance={{ baseTheme: dark, elements: { avatarBox: "h-8 w-8 rounded-xl" } }} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
