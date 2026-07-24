"use client";

import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Building2,
  ShoppingBag,
  Wifi,
  UtensilsCrossed,
  MessageSquare,
  Bot,
  Star,
  Gift,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { motion } from "framer-motion";

export function DashboardOverviewClient({ orgId }: { orgId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const stats = useQuery(
    api.analytics.getOverviewStats,
    isAuthenticated ? { orgId } : "skip"
  );

  // Handle loading state
  if (stats === undefined) {
    return (
      <div className="space-y-6 font-sans text-v-ink">
        <div className="animate-pulse">
          <div className="mb-2 h-8 w-48 rounded-v bg-white/[0.06]" />
          <div className="h-4 w-96 max-w-full rounded-v bg-white/[0.03]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-[116px] animate-pulse rounded-v border-v-line bg-v-bg-raise shadow-none" />
          ))}
        </div>
      </div>
    );
  }

  // Handle org not found or no stats
  if (stats === null) {
    return (
      <div className="text-v-mut">
        Workspace not found. Please select a valid workspace.
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans text-v-ink">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
        <h1 className="font-v-display text-2xl font-medium tracking-tight text-v-ink sm:text-3xl">
          Overview
        </h1>
        <p className="v-t-micro mt-2 flex items-center gap-2 text-v-mut">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-v-accent opacity-60"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-v-accent"></span>
          </span>
          Live data feed active for {stats.orgName}
        </p>
      </div>

      {/* Surprise Bags promo card */}
      <Link
        href="/bags-dashboard"
        className="v-press group relative flex items-center justify-between rounded-v border border-v-line bg-v-bg-raise p-5 transition-colors hover:border-v-accent/40 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-mode-both"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-v border border-v-line">
            <Gift className="h-6 w-6 text-v-accent" />
          </div>
          <div>
            <p className="text-base font-medium text-v-ink">Surprise Bags</p>
            <p className="text-sm text-v-mut">
              Sell today&apos;s surplus food as discounted surprise bags
            </p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-v-accent transition-transform group-hover:translate-x-1" />
      </Link>

      {/* General Stats Grid */}
      <section className="space-y-3">
        <div className="border-b border-v-line pb-2">
          <h2 className="v-t-micro text-v-faint">01 — At a glance</h2>
        </div>
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
                className={`animate-in fade-in slide-in-from-bottom-4 duration-700 ${delayClass} fill-mode-both rounded-v border-v-line bg-v-bg-raise shadow-none`}
              >
                <CardHeader className="pb-2">
                  <CardDescription className="v-t-micro flex items-center gap-1.5 text-v-faint">
                    <Icon className="h-3.5 w-3.5 text-v-faint" />
                    {stat.label}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <motion.div
                    key={stat.value}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-v-display text-3xl font-medium tabular-nums text-v-ink"
                  >
                    {stat.value}
                  </motion.div>
                  <p className="mt-1 text-xs text-v-faint">{stat.sub}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* AI Consultation Analytics */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-[800ms] fill-mode-both space-y-3">
        <div className="flex items-center gap-2 border-b border-v-line pb-2">
          <Bot className="h-4 w-4 text-v-faint" />
          <h2 className="v-t-micro text-v-faint">02 — VolooAI analytics</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="rounded-v border-v-line bg-v-bg-raise shadow-none">
            <CardHeader className="pb-2">
              <CardDescription className="v-t-micro flex items-center gap-1.5 text-v-faint">
                <MessageSquare className="h-3.5 w-3.5 text-v-faint" />
                Total AI Sessions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <motion.div
                key={stats.aiAnalytics.totalSessions}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="font-v-display text-3xl font-medium tabular-nums text-v-ink"
              >
                {stats.aiAnalytics.totalSessions}
              </motion.div>
              <p className="mt-1 text-xs text-v-faint">Anonymous customer threads</p>
            </CardContent>
          </Card>

          <Card className="rounded-v border-v-line bg-v-bg-raise shadow-none">
            <CardHeader className="pb-2">
              <CardDescription className="v-t-micro flex items-center gap-1.5 text-v-faint">
                <Bot className="h-3.5 w-3.5 text-v-faint" />
                Messages Processed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <motion.div
                key={stats.aiAnalytics.totalMessages}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="font-v-display text-3xl font-medium tabular-nums text-v-ink"
              >
                {stats.aiAnalytics.totalMessages}
              </motion.div>
              <p className="mt-1 text-xs text-v-faint">Messages exchanged</p>
            </CardContent>
          </Card>

          <Card className="rounded-v border-v-line bg-v-bg-raise shadow-none">
            <CardHeader className="pb-2">
              <CardDescription className="v-t-micro flex items-center gap-1.5 text-v-faint">
                <Star className="h-3.5 w-3.5 text-v-faint" />
                Average Rating
              </CardDescription>
            </CardHeader>
            <CardContent>
              <motion.div
                key={stats.aiAnalytics.averageRating}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="font-v-display text-3xl font-medium tabular-nums text-v-ink"
              >
                {stats.aiAnalytics.averageRating}
              </motion.div>
              <p className="mt-1 text-xs text-v-faint">Customer satisfaction</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
