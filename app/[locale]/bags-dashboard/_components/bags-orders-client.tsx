"use client";

import { useState } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import {
  QrCode,
  CheckCircle2,
  PackageCheck,
  UserX,
  Inbox,
  Loader2,
  Bike,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { gel, tName } from "./lib";

function errMsg(e: unknown): string {
  return e instanceof ConvexError && typeof e.data === "string"
    ? e.data
    : "Something went wrong. Please try again.";
}

type OrderRow = NonNullable<
  ReturnType<typeof useQuery<typeof api.bagOrders.listOrgOrders>>
>[number];

const GROUPS = [
  { key: "active", label: "Awaiting pickup", statuses: ["paid", "ready"] },
  {
    key: "done",
    label: "Completed",
    statuses: ["collected", "delivered"],
  },
  { key: "no_show", label: "No-shows", statuses: ["no_show"] },
] as const;

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: "bg-sky-400/10 text-sky-300",
    ready: "bg-amber-400/10 text-amber-300",
    collected: "bg-emerald-400/10 text-emerald-300",
    delivered: "bg-emerald-400/10 text-emerald-300",
    no_show: "bg-red-400/10 text-red-300",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
        styles[status] ?? "bg-white/5 text-zinc-400",
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function BagsOrdersClient({ orgId }: { orgId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const orders = useQuery(
    api.bagOrders.listOrgOrders,
    isAuthenticated ? { orgId } : "skip",
  );
  const redeemCode = useMutation(api.bagOrders.redeemPickupCode);
  const updateStatus = useMutation(api.bagOrders.updateOrderStatus);

  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);

  const handleRedeem = async () => {
    if (code.trim().length === 0) return;
    setRedeeming(true);
    try {
      await redeemCode({ orgId, code: code.trim() });
      toast.success(`Code ${code.trim().toUpperCase()} redeemed — enjoy!`);
      setCode("");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setRedeeming(false);
    }
  };

  const handleStatus = async (
    orderId: Id<"bagOrders">,
    status: "ready" | "no_show",
  ) => {
    setBusyOrder(orderId);
    try {
      await updateStatus({ orgId, orderId, status });
      toast.success(
        status === "ready" ? "Marked as ready." : "Marked as no-show.",
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyOrder(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
        <h1 className="text-2xl font-medium tracking-tight text-white sm:text-3xl">
          Bag orders
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Live incoming reservations — updates in realtime.
        </p>
      </div>

      {/* Redeem pickup code */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 border-t-white/25 bg-white/[0.06] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)] backdrop-blur-xl backdrop-saturate-150">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/[0.10] to-transparent"
        />
        <div className="mb-3 flex items-center gap-2">
          <QrCode className="h-4 w-4 text-emerald-300" />
          <h2 className="text-sm font-semibold text-white">
            Redeem pickup code
          </h2>
        </div>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
            placeholder="e.g. K7X2ND"
            autoCapitalize="characters"
            className="w-full flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-base uppercase tabular-nums tracking-[0.2em] text-white placeholder:tracking-normal placeholder:text-zinc-600 outline-none transition-colors focus:border-emerald-400/40"
          />
          <button
            onClick={handleRedeem}
            disabled={redeeming || code.trim().length === 0}
            className="flex shrink-0 items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition-[background-color,transform] duration-150 ease-out hover:bg-zinc-200 active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none"
          >
            {redeeming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Redeem
          </button>
        </div>
      </div>

      {/* Orders grouped by status */}
      {orders === undefined ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center backdrop-blur-xl">
          <Inbox className="mb-3 h-8 w-8 text-zinc-600" />
          <p className="text-sm font-medium text-zinc-300">No orders yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            Reservations appear here the moment a customer pays.
          </p>
        </div>
      ) : (
        GROUPS.map((group) => {
          const rows = orders.filter((o: OrderRow) =>
            (group.statuses as readonly string[]).includes(o.status),
          );
          if (rows.length === 0) return null;
          return (
            <section key={group.key} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                {group.label}
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-300">
                  {rows.length}
                </span>
              </h2>
              <div className="space-y-3">
                {rows.map((order: OrderRow) => {
                  const actionable =
                    order.status === "paid" || order.status === "ready";
                  return (
                    <div
                      key={order._id}
                      className="relative overflow-hidden rounded-3xl border border-white/10 border-t-white/25 bg-white/[0.06] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)] backdrop-blur-xl backdrop-saturate-150 transition-all duration-200 ease-out md:hover:-translate-y-0.5 md:hover:shadow-[0_12px_36px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.15)]"
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/[0.10] to-transparent"
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">
                            {tName(order.bagTitle)}{" "}
                            <span className="font-normal text-zinc-400">
                              × {order.quantity}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-zinc-400">
                            {order.buyerName} · {gel(order.totalAmount)}
                            {order.fulfillmentType === "delivery" && (
                              <span className="ml-1.5 inline-flex items-center gap-1 text-sky-300">
                                <Bike className="h-3 w-3" /> delivery
                              </span>
                            )}
                          </p>
                        </div>
                        <StatusPill status={order.status} />
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="rounded-xl border border-white/10 border-t-white/20 bg-black/40 px-3 py-1.5 font-mono text-sm font-bold tabular-nums tracking-[0.2em] text-emerald-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)]">
                          {order.pickupCode}
                        </div>
                        {actionable && (
                          <div className="flex gap-2">
                            {order.status === "paid" && (
                              <button
                                onClick={() =>
                                  handleStatus(order._id, "ready")
                                }
                                disabled={busyOrder === order._id}
                                className="flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-[color,background-color,transform] duration-150 ease-out hover:bg-amber-400/20 active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none"
                              >
                                <PackageCheck className="h-3.5 w-3.5" />
                                Ready
                              </button>
                            )}
                            <button
                              onClick={() =>
                                handleStatus(order._id, "no_show")
                              }
                              disabled={busyOrder === order._id}
                              className="flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-[color,background-color,transform] duration-150 ease-out hover:bg-red-400/20 active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none"
                            >
                              <UserX className="h-3.5 w-3.5" />
                              No-show
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
