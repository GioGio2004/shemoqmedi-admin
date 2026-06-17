"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { 
  Building2, 
  ShoppingBag, 
  Wifi, 
  UtensilsCrossed, 
  MessageSquare, 
  Bot, 
  Star 
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";

export function DashboardOverviewClient({ orgId }: { orgId: string }) {
  const stats = useQuery(api.analytics.getOverviewStats, { orgId });

  // Handle loading state
  if (stats === undefined) {
    return (
      <div className="space-y-6 text-zinc-50 font-sans">
        <div className="animate-pulse">
          <div className="h-8 w-48 bg-white/10 rounded mb-2" />
          <div className="h-4 w-96 bg-white/5 rounded" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="bg-[#09090b] border-white/10 shadow-none h-[116px] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Handle org not found or no stats
  if (stats === null) {
    return (
      <div className="text-zinc-400">
        Workspace not found. Please select a valid workspace.
      </div>
    );
  }

  return (
    <div className="space-y-6 text-zinc-50 font-sans">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
        <h1 className="text-3xl font-medium tracking-tight text-white">
          Overview
        </h1>
        <p className="text-sm text-emerald-400 mt-1 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Live data feed active for {stats.orgName}
        </p>
      </div>

      {/* General Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Menu Items",
            value: stats.activeMenuItemsCount,
            sub: "Active items",
            icon: UtensilsCrossed,
          },
          {
            label: "Open Orders",
            value: stats.openOrdersCount,
            sub: "Pending & preparing",
            icon: ShoppingBag,
          },
          {
            label: "Online Tags",
            value: stats.activeTagsCount,
            sub: "Active NFC terminals",
            icon: Wifi,
          },
          {
            label: "Workspace",
            value: "Active",
            sub: orgId.slice(0, 14) + "…",
            icon: Building2,
          },
        ].map((stat, idx) => {
          const Icon = stat.icon;
          const delayClass = ["delay-200", "delay-300", "delay-500", "delay-700"][idx % 4];

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
                <motion.div
                  key={stat.value}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-3xl font-medium tabular-nums text-white"
                >
                  {stat.value}
                </motion.div>
                <p className="text-xs text-zinc-500 mt-1 font-medium">{stat.sub}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* AI Consultation Analytics */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-[800ms] fill-mode-both mt-8">
        <h2 className="text-xl font-medium tracking-tight text-white mb-4 flex items-center gap-2">
          <Bot className="h-5 w-5 text-emerald-400" />
          VolooAI Consultation Analytics
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="bg-[#09090b] border-white/10 shadow-none hover:border-emerald-500/30 transition-all group">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                <MessageSquare className="h-3.5 w-3.5 text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                Total AI Sessions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <motion.div
                key={stats.aiAnalytics.totalSessions}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-3xl font-medium tabular-nums text-emerald-50"
              >
                {stats.aiAnalytics.totalSessions}
              </motion.div>
              <p className="text-xs text-zinc-500 mt-1 font-medium">Anonymous customer threads</p>
            </CardContent>
          </Card>

          <Card className="bg-[#09090b] border-white/10 shadow-none hover:border-emerald-500/30 transition-all group">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                <Bot className="h-3.5 w-3.5 text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                Messages Processed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <motion.div
                key={stats.aiAnalytics.totalMessages}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-3xl font-medium tabular-nums text-emerald-50"
              >
                {stats.aiAnalytics.totalMessages}
              </motion.div>
              <p className="text-xs text-zinc-500 mt-1 font-medium">Messages exchanged</p>
            </CardContent>
          </Card>

          <Card className="bg-[#09090b] border-white/10 shadow-none hover:border-amber-500/30 transition-all group">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                <Star className="h-3.5 w-3.5 text-zinc-400 group-hover:text-amber-400 transition-colors" />
                Average Rating
              </CardDescription>
            </CardHeader>
            <CardContent>
              <motion.div
                key={stats.aiAnalytics.averageRating}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-3xl font-medium tabular-nums text-amber-50"
              >
                {stats.aiAnalytics.averageRating}
              </motion.div>
              <p className="text-xs text-zinc-500 mt-1 font-medium">Customer satisfaction</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
