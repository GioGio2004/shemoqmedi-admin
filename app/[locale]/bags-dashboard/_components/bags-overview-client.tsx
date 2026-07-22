"use client";

import { useState } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import {
  Plus,
  Clock,
  Package,
  Ban,
  Sparkles,
  CalendarX2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { gel, tName, fmtTime, discountPct } from "./lib";
import { PostBagDialog } from "./post-bag-dialog";

function errMsg(e: unknown): string {
  return e instanceof ConvexError && typeof e.data === "string"
    ? e.data
    : "Something went wrong. Please try again.";
}

export function BagsOverviewClient({ orgId }: { orgId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const bags = useQuery(
    api.surpriseBags.listOrgBags,
    isAuthenticated ? { orgId } : "skip",
  );
  const cancelBag = useMutation(api.surpriseBags.cancelBag);
  const [postOpen, setPostOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const now = Date.now();
  const liveBags = (bags ?? []).filter(
    (b) => b.status === "active" && (b.pickupEnd ?? 0) > now,
  );
  const pastBags = (bags ?? [])
    .filter((b) => !(b.status === "active" && (b.pickupEnd ?? 0) > now))
    .slice(0, 10);

  const handleCancel = async (bagId: Id<"surpriseBags">) => {
    setCancelling(bagId);
    try {
      await cancelBag({ orgId, bagId });
      toast.success("Bag cancelled. Unsold quantity withdrawn.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
        <h1 className="text-2xl font-medium tracking-tight text-white sm:text-3xl">
          Today&apos;s bags
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Post leftover food as discounted surprise bags — sold in realtime.
        </p>
      </div>

      {/* Post CTA */}
      <button
        onClick={() => setPostOpen(true)}
        className="group relative flex w-full items-center justify-between overflow-hidden rounded-3xl border border-emerald-400/25 border-t-white/20 bg-gradient-to-br from-emerald-400/15 via-emerald-400/5 to-transparent p-5 text-left shadow-[0_4px_20px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-xl backdrop-saturate-150 transition-all duration-200 ease-out hover:border-emerald-400/40 active:scale-[0.97] motion-reduce:transform-none md:hover:-translate-y-0.5 md:hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.12)]"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.08] to-transparent"
        />
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/15 ring-1 ring-emerald-400/30">
            <Sparkles className="h-6 w-6 text-emerald-300" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">Post a bag</p>
            <p className="text-sm text-zinc-400">
              From a template or compose a new one
            </p>
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg shadow-emerald-500/10 transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none">
          <Plus className="h-5 w-5" />
        </div>
      </button>

      {/* Live bags */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Live now
          </h2>
        </div>

        {bags === undefined ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-[104px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
              />
            ))}
          </div>
        ) : liveBags.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center backdrop-blur-xl">
            <CalendarX2 className="mb-3 h-8 w-8 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">
              No live bags right now
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Post today&apos;s surplus and it goes live instantly.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {liveBags.map((bag) => {
              const sold = (bag.quantityTotal ?? 0) - (bag.quantityLeft ?? 0);
              return (
                <div
                  key={bag._id}
                  className="relative overflow-hidden rounded-3xl border border-white/10 border-t-white/25 bg-white/[0.06] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)] backdrop-blur-xl backdrop-saturate-150 transition-all duration-200 ease-out hover:border-white/20 md:hover:-translate-y-0.5 md:hover:shadow-[0_12px_36px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.15)]"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/[0.10] to-transparent"
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-white">
                        {tName(bag.title)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                        <span className="flex items-center gap-1 tabular-nums">
                          <Clock className="h-3.5 w-3.5" />
                          {fmtTime(bag.pickupStart)} – {fmtTime(bag.pickupEnd)}
                        </span>
                        <span className="flex items-center gap-1 tabular-nums">
                          <Package className="h-3.5 w-3.5" />
                          {bag.quantityLeft} left
                          {sold > 0 && (
                            <span className="text-emerald-400">
                              · {sold} sold
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-lg font-semibold tabular-nums tracking-tight text-emerald-300">
                          {gel(bag.price)}
                        </span>
                        <span className="text-xs tabular-nums text-zinc-500 line-through">
                          {gel(bag.originalValue)}
                        </span>
                        {bag.originalValue !== undefined &&
                          bag.price !== undefined && (
                            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                              −{discountPct(bag.originalValue, bag.price)}%
                            </span>
                          )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancel(bag._id)}
                      disabled={cancelling === bag._id}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-[color,background-color,transform] duration-150 ease-out hover:bg-red-400/20 active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      {cancelling === bag._id ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* History */}
      {pastBags.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Recent
          </h2>
          <div className="overflow-hidden rounded-3xl border border-white/10 border-t-white/20 bg-white/[0.03] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)] backdrop-blur-xl backdrop-saturate-150">
            {pastBags.map((bag, i) => (
              <div
                key={bag._id}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3",
                  i > 0 && "border-t border-white/5",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-300">
                    {tName(bag.title)}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {new Date(bag.createdAt).toLocaleDateString()} ·{" "}
                    {(bag.quantityTotal ?? 0) - (bag.quantityLeft ?? 0)}/
                    {bag.quantityTotal ?? 0} sold
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
                    bag.status === "cancelled"
                      ? "bg-red-400/10 text-red-300"
                      : bag.status === "active"
                        ? "bg-zinc-400/10 text-zinc-300"
                        : "bg-white/5 text-zinc-400",
                  )}
                >
                  {bag.status === "active" ? "ended" : bag.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <PostBagDialog orgId={orgId} open={postOpen} onOpenChange={setPostOpen} />
    </div>
  );
}
