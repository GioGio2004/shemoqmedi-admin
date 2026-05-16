import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Building2, ShoppingBag, Wifi, UtensilsCrossed } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardOverviewPage() {
  const { userId, orgId } = await auth();

  // Guard: must be authenticated to access dashboard
  if (!userId) redirect("/sign-in");

  return (
    <div className="space-y-6 text-zinc-50 font-sans">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
        <h1 className="text-3xl font-medium tracking-tight text-white">
          Overview
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
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
          },
          {
            label: "Open Orders",
            value: "—",
            sub: "Pending & preparing",
            icon: ShoppingBag,
          },
          {
            label: "Online Tags",
            value: "—",
            sub: "Active NFC terminals",
            icon: Wifi,
          },
          {
            label: "Workspace",
            value: orgId ? "Active" : "None",
            sub: orgId ? orgId.slice(0, 14) + "…" : "Select an org",
            icon: Building2,
          },
        ].map((stat, idx) => {
          const Icon = stat.icon;
          // stagger delays for cards
          const delayClass = [
            "delay-200",
            "delay-300",
            "delay-500",
            "delay-700"
          ][idx % 4];

          return (
            <Card
              key={stat.label}
              className={`animate-in fade-in slide-in-from-bottom-4 duration-700 ${delayClass} fill-mode-both bg-[#09090b] border-white/10 shadow-none hover:border-white/20 transition-all`}
            >
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                  <Icon className="h-3.5 w-3.5 text-zinc-400" />
                  {stat.label}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-medium tabular-nums text-white">
                  {stat.value}
                </div>
                <p className="text-xs text-zinc-500 mt-1 font-medium">{stat.sub}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Placeholder content panel */}
      <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-1000 fill-mode-both bg-[#09090b] border-white/10 border-dashed shadow-none">
        <CardHeader>
          <CardTitle className="text-zinc-300 text-base font-medium">
            Sprint 2 — Live Data Coming Soon
          </CardTitle>
          <CardDescription className="text-zinc-500">
            Convex realtime queries for categories, menu items, and order pipeline will be wired here.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}