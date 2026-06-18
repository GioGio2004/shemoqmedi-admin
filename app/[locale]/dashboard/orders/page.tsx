"use client";

import { useOrganization } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Loader2,
  ShoppingBag,
  CheckCircle,
  XCircle,
  Clock,
  Receipt,
  Hash,
  ChefHat,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const STATUS_CONFIG = {
  pending: {
    label: "Pending",
    icon: Clock,
    classes: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    dot: "bg-amber-400 animate-pulse",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle,
    classes: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    dot: "bg-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    classes: "bg-red-500/10 text-red-400 border border-red-500/20",
    dot: "bg-red-400",
  },
} as const;

export default function OrdersPage() {
  const { organization, isLoaded } = useOrganization();
  const orgSlug = organization?.slug ?? null;

  const orders = useQuery(api.orders.getOrders, orgSlug ? { cafeId: orgSlug } : "skip");
  const updateStatus = useMutation(api.orders.updateOrderStatus);

  if (!isLoaded || orders === undefined) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!orgSlug) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="font-medium text-foreground">No workspace selected</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          Select a workspace from the sidebar to view its orders.
        </p>
      </div>
    );
  }

  const pending = orders.filter((o) => o.status === "pending");
  const others = orders.filter((o) => o.status !== "pending");

  return (
    <div className="space-y-6 max-w-5xl text-zinc-50 pb-20">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="h-5 w-5 text-white" />
            <h1 className="text-3xl font-medium tracking-tight text-white">Orders</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Real-time orders placed by customers at {organization?.name}.
          </p>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {pending.length} pending
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-zinc-400 text-xs font-semibold">
            <Receipt className="w-3 h-3" />
            {orders.length} total
          </div>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="p-16 border border-white/5 bg-white/[0.02] rounded-2xl flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
            <ShoppingBag className="w-8 h-8 text-zinc-700" />
          </div>
          <div>
            <p className="text-zinc-300 font-medium text-lg">No orders yet</p>
            <p className="text-sm text-zinc-500 mt-1 max-w-xs">
              When customers place an order from the AI chat, it will appear here in real-time.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending orders first */}
          {pending.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Timer className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-widest">
                  Awaiting Action
                </h2>
              </div>
              <div className="grid gap-3">
                {pending.map((order) => (
                  <OrderCard key={order._id} order={order} updateStatus={updateStatus} />
                ))}
              </div>
            </section>
          )}

          {/* Completed / cancelled */}
          {others.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <ChefHat className="w-4 h-4 text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">
                  History
                </h2>
              </div>
              <div className="grid gap-3">
                {others.map((order) => (
                  <OrderCard key={order._id} order={order} updateStatus={updateStatus} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({
  order,
  updateStatus,
}: {
  order: any;
  updateStatus: any;
}) {
  const status = STATUS_CONFIG[order.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        "border rounded-2xl overflow-hidden transition-all duration-300",
        order.status === "pending"
          ? "border-amber-500/20 bg-[#0f0d09]"
          : "border-white/[0.06] bg-[#09090b]"
      )}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          {/* Seat badge */}
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center shrink-0">
            <Hash className="w-3 h-3 text-zinc-600 mb-0" />
            <span className="text-sm font-black text-white leading-none">{order.seatNumber}</span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Table {order.seatNumber}</span>
              <span className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold", status.classes)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
                {status.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-zinc-500 font-mono">{formatTime(order.createdAt)}</span>
              <span className="text-zinc-700">·</span>
              <span className="text-[11px] text-zinc-500">{formatRelativeTime(order.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Total */}
        <div className="text-right">
          <p className="text-xs text-zinc-500 font-medium mb-0.5">
            {order.items.length} item{order.items.length !== 1 ? "s" : ""}
          </p>
          <p className="text-lg font-black font-mono text-white tabular-nums">
            ${(order.totalPrice / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Items breakdown */}
      <div className="px-5 py-4">
        <div className="space-y-2.5">
          {order.items.map((item: any, idx: number) => (
            <div key={idx} className="flex items-start gap-3">
              {/* Quantity chip */}
              <div
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white border"
                style={{
                  backgroundColor: "rgba(234,88,12,0.12)",
                  borderColor: "rgba(234,88,12,0.2)",
                  color: "#f97316",
                }}
              >
                {item.quantity}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white truncate">{item.name}</p>
                  <p className="text-sm font-mono text-zinc-300 font-medium shrink-0 tabular-nums">
                    ${((item.price * item.quantity) / 100).toFixed(2)}
                  </p>
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  ${(item.price / 100).toFixed(2)} each
                  {item.quantity > 1 && (
                    <span className="text-zinc-600"> · {item.quantity}×</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Subtotal breakdown */}
        <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-600">Order Total</span>
          <span className="text-base font-black font-mono text-white tabular-nums">
            ${(order.totalPrice / 100).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Actions */}
      {order.status === "pending" && (
        <div className="px-5 pb-4 flex gap-2">
          <button
            onClick={() => updateStatus({ orderId: order._id, status: "completed" })}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 text-emerald-950 font-bold text-sm transition-all hover:bg-emerald-400 active:scale-95"
          >
            <CheckCircle className="w-4 h-4" />
            Mark Complete
          </button>
          <button
            onClick={() => updateStatus({ orderId: order._id, status: "cancelled" })}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-transparent border border-red-500/30 text-red-400 font-bold text-sm transition-all hover:bg-red-500/10 active:scale-95"
          >
            <XCircle className="w-4 h-4" />
            Cancel
          </button>
        </div>
      )}

      {order.status === "completed" && order.completedAt && (
        <div className="px-5 pb-4">
          <p className="text-[11px] text-zinc-600 font-mono">
            Completed at {formatTime(order.completedAt)}
          </p>
        </div>
      )}
    </div>
  );
}
