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
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
        <h1 className="font-v-display text-2xl font-medium tracking-tight text-v-ink sm:text-3xl">
          Today&apos;s bags
        </h1>
        <p className="mt-1 text-sm text-v-mut">
          Post leftover food as discounted surprise bags — sold in realtime.
        </p>
      </div>

      {/* Post CTA */}
      <button
        onClick={() => setPostOpen(true)}
        className="v-press group flex w-full items-center justify-between rounded-v bg-v-accent p-5 text-left text-v-accent-ink transition-[filter] duration-150 ease-out hover:brightness-95"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-v border border-v-accent-ink/25">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-semibold">Post a bag</p>
            <p className="text-sm text-v-accent-ink/70">
              From a template or compose a new one
            </p>
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-v-accent-ink text-v-accent">
          <Plus className="h-5 w-5" />
        </div>
      </button>

      {/* Live bags */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 border-b border-v-line pb-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-v-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-v-accent" />
          </span>
          <h2 className="v-t-micro text-v-mut">01 — Live now</h2>
        </div>

        {bags === undefined ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-[104px] animate-pulse rounded-v border border-v-line bg-white/[0.03]"
              />
            ))}
          </div>
        ) : liveBags.length === 0 ? (
          <div className="flex flex-col items-center rounded-v border border-dashed border-v-line px-6 py-10 text-center">
            <CalendarX2 className="mb-3 h-8 w-8 text-v-faint" />
            <p className="text-sm font-medium text-v-mut">
              No live bags right now
            </p>
            <p className="mt-1 text-xs text-v-faint">
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
                  className="rounded-v border border-v-line bg-v-bg-raise p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium text-v-ink">
                        {tName(bag.title)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-v-mut">
                        <span className="flex items-center gap-1 font-v-mono tabular-nums">
                          <Clock className="h-3.5 w-3.5" />
                          {fmtTime(bag.pickupStart)} – {fmtTime(bag.pickupEnd)}
                        </span>
                        <span className="flex items-center gap-1 font-v-mono tabular-nums">
                          <Package className="h-3.5 w-3.5" />
                          {bag.quantityLeft} left
                          {sold > 0 && <span>· {sold} sold</span>}
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="font-v-mono text-lg font-medium tabular-nums tracking-tight text-v-ink">
                          {gel(bag.price)}
                        </span>
                        <span className="font-v-mono text-xs tabular-nums text-v-faint line-through">
                          {gel(bag.originalValue)}
                        </span>
                        {bag.originalValue !== undefined &&
                          bag.price !== undefined && (
                            <span className="v-t-micro rounded-v border border-v-line px-1.5 py-0.5 tabular-nums text-v-mut">
                              −{discountPct(bag.originalValue, bag.price)}%
                            </span>
                          )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancel(bag._id)}
                      disabled={cancelling === bag._id}
                      className="v-press flex shrink-0 items-center gap-1.5 rounded-v border border-red-400/25 px-3 py-1.5 text-xs font-medium text-red-400/90 transition-colors hover:bg-red-400/10 disabled:opacity-50"
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
          <div className="border-b border-v-line pb-2">
            <h2 className="v-t-micro text-v-faint">02 — Recent</h2>
          </div>
          <div className="overflow-hidden rounded-v border border-v-line bg-v-bg-raise">
            {pastBags.map((bag, i) => (
              <div
                key={bag._id}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3",
                  i > 0 && "border-t border-v-line",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-v-mut">
                    {tName(bag.title)}
                  </p>
                  <p className="font-v-mono text-xs tabular-nums text-v-faint">
                    {new Date(bag.createdAt).toLocaleDateString()} ·{" "}
                    {(bag.quantityTotal ?? 0) - (bag.quantityLeft ?? 0)}/
                    {bag.quantityTotal ?? 0} sold
                  </p>
                </div>
                <span
                  className={cn(
                    "v-t-micro shrink-0 rounded-v border px-2 py-0.5",
                    bag.status === "cancelled"
                      ? "border-red-400/25 text-red-400/90"
                      : "border-v-line text-v-faint",
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
