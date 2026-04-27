import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Building2, ShoppingBag, Wifi, UtensilsCrossed } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardOverviewPage() {
  const { userId, orgId } = await auth();

  // Guard: must be authenticated to access dashboard
  if (!userId) redirect("/sign-in");

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
          Overview
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {orgId
            ? "Your workspace is active. Real-time data coming in Sprint 2."
            : "Select a workspace using the switcher in the sidebar to get started."}
        </p>
      </div>

      {/* Stat grid — wired to live Convex queries in Sprint 2 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Menu Items",
            value: "—",
            sub: "Active items",
            icon: UtensilsCrossed,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "Open Orders",
            value: "—",
            sub: "Pending & preparing",
            icon: ShoppingBag,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
          },
          {
            label: "Online Tags",
            value: "—",
            sub: "Active NFC terminals",
            icon: Wifi,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
          {
            label: "Workspace",
            value: orgId ? "Active" : "None",
            sub: orgId ? orgId.slice(0, 14) + "…" : "Select an org",
            icon: Building2,
            color: "text-zinc-400",
            bg: "bg-zinc-700/40",
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <Card
              key={stat.label}
              className="relative overflow-hidden bg-zinc-900 border-zinc-800/60"
            >
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <div className={`flex h-5 w-5 items-center justify-center rounded-md ${stat.bg}`}>
                    <Icon className={`h-3 w-3 ${stat.color}`} />
                  </div>
                  {stat.label}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums text-zinc-100">
                  {stat.value}
                </div>
                <p className="text-xs text-zinc-600 mt-1">{stat.sub}</p>
              </CardContent>
              <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full opacity-40 blur-xl"
                style={{ background: `oklch(0.718 0.195 53.4 / 0.08)` }} />
            </Card>
          );
        })}
      </div>

      {/* Placeholder content panel */}
      <Card className="bg-zinc-900 border-zinc-800/60 border-dashed">
        <CardHeader>
          <CardTitle className="text-zinc-400 text-base">
            Sprint 2 — Live Data Coming Soon
          </CardTitle>
          <CardDescription className="text-zinc-600">
            Convex realtime queries for categories, menu items, and order pipeline will be wired here.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}