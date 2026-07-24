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
    paid: "border-v-line text-v-ink",
    ready: "border-v-accent/40 text-v-accent",
    collected: "border-v-line text-v-mut",
    delivered: "border-v-line text-v-mut",
    no_show: "border-red-400/25 text-red-400/90",
  };
  return (
    <span
      className={cn(
        "v-t-micro rounded-v border px-2 py-0.5",
        styles[status] ?? "border-v-line text-v-faint",
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
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
        <h1 className="font-v-display text-2xl font-medium tracking-tight text-v-ink sm:text-3xl">
          Bag orders
        </h1>
        <p className="mt-1 text-sm text-v-mut">
          Live incoming reservations — updates in realtime.
        </p>
      </div>

      {/* Redeem pickup code */}
      <div className="rounded-v border border-v-line bg-v-bg-raise p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-v-line pb-2">
          <QrCode className="h-4 w-4 text-v-mut" />
          <h2 className="v-t-micro text-v-mut">Redeem pickup code</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
            placeholder="e.g. K7X2ND"
            autoCapitalize="characters"
            className="w-full flex-1 rounded-v border border-v-line bg-white/[0.03] px-4 py-3 font-v-mono text-base uppercase tabular-nums tracking-[0.2em] text-v-ink outline-none transition-colors placeholder:tracking-normal placeholder:text-v-faint focus:border-v-accent"
          />
          <button
            onClick={handleRedeem}
            disabled={redeeming || code.trim().length === 0}
            className="v-press flex shrink-0 items-center justify-center gap-2 rounded-v bg-v-accent px-5 py-3 text-sm font-semibold text-v-accent-ink transition-[filter] duration-150 ease-out hover:brightness-95 disabled:opacity-50"
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
              className="h-24 animate-pulse rounded-v border border-v-line bg-white/[0.03]"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center rounded-v border border-dashed border-v-line px-6 py-12 text-center">
          <Inbox className="mb-3 h-8 w-8 text-v-faint" />
          <p className="text-sm font-medium text-v-mut">No orders yet</p>
          <p className="mt-1 text-xs text-v-faint">
            Reservations appear here the moment a customer pays.
          </p>
        </div>
      ) : (
        GROUPS.map((group, gi) => {
          const rows = orders.filter((o: OrderRow) =>
            (group.statuses as readonly string[]).includes(o.status),
          );
          if (rows.length === 0) return null;
          return (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center gap-2 border-b border-v-line pb-2">
                <h2 className="v-t-micro text-v-mut">
                  {String(gi + 1).padStart(2, "0")} — {group.label}
                </h2>
                <span className="v-t-micro rounded-v border border-v-line px-1.5 py-0.5 tabular-nums text-v-faint">
                  {rows.length}
                </span>
              </div>
              <div className="space-y-3">
                {rows.map((order: OrderRow) => {
                  const actionable =
                    order.status === "paid" || order.status === "ready";
                  return (
                    <div
                      key={order._id}
                      className="rounded-v border border-v-line bg-v-bg-raise p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-v-ink">
                            {tName(order.bagTitle)}{" "}
                            <span className="font-normal text-v-mut">
                              × {order.quantity}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-v-mut">
                            {order.buyerName} ·{" "}
                            <span className="font-v-mono">
                              {gel(order.totalAmount)}
                            </span>
                            {order.fulfillmentType === "delivery" && (
                              <span className="ml-1.5 inline-flex items-center gap-1 text-v-faint">
                                <Bike className="h-3 w-3" /> delivery
                              </span>
                            )}
                          </p>
                        </div>
                        <StatusPill status={order.status} />
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="rounded-v border border-v-line bg-v-bg px-3 py-1.5 font-v-mono text-sm font-medium tabular-nums tracking-[0.2em] text-v-ink">
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
                                className="v-press flex items-center gap-1.5 rounded-v bg-v-accent px-3 py-1.5 text-xs font-semibold text-v-accent-ink transition-[filter] duration-150 ease-out hover:brightness-95 disabled:opacity-50"
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
                              className="v-press flex items-center gap-1.5 rounded-v border border-red-400/25 px-3 py-1.5 text-xs font-medium text-red-400/90 transition-colors hover:bg-red-400/10 disabled:opacity-50"
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
