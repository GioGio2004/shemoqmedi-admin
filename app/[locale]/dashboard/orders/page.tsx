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
    classes: "border border-v-accent/40 text-v-accent",
    dot: "bg-v-accent animate-pulse",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle,
    classes: "border border-v-line text-v-mut",
    dot: "bg-v-faint",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    classes: "border border-red-400/25 text-red-400/90",
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
        <Loader2 className="h-6 w-6 animate-spin text-v-faint" />
      </div>
    );
  }

  if (!orgSlug) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="font-medium text-v-ink">No workspace selected</p>
        <p className="max-w-xs text-sm text-v-mut">
          Select a workspace from the sidebar to view its orders.
        </p>
      </div>
    );
  }

  const pending = orders.filter((o) => o.status === "pending");
  const others = orders.filter((o) => o.status !== "pending");

  return (
    <div className="max-w-5xl space-y-8 pb-20 text-v-ink">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="h-5 w-5 text-v-mut" />
            <h1 className="font-v-display text-2xl font-medium tracking-tight text-v-ink sm:text-3xl">
              Orders
            </h1>
          </div>
          <p className="text-sm text-v-mut">
            Real-time orders placed by customers at {organization?.name}.
          </p>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="v-t-micro flex items-center gap-1.5 rounded-full border border-v-accent/40 px-3 py-1.5 tabular-nums text-v-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-v-accent" />
            {pending.length} pending
          </div>
          <div className="v-t-micro flex items-center gap-1.5 rounded-full border border-v-line px-3 py-1.5 tabular-nums text-v-mut">
            <Receipt className="h-3 w-3" />
            {orders.length} total
          </div>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-v border border-dashed border-v-line p-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
            <ShoppingBag className="h-8 w-8 text-v-faint" />
          </div>
          <div>
            <p className="text-lg font-medium text-v-mut">No orders yet</p>
            <p className="mt-1 max-w-xs text-sm text-v-faint">
              When customers place an order from the AI chat, it will appear here in real-time.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Pending orders first */}
          {pending.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2 border-b border-v-line pb-2">
                <Timer className="h-4 w-4 text-v-accent" />
                <h2 className="v-t-micro text-v-mut">01 — Awaiting action</h2>
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
              <div className="mb-3 flex items-center gap-2 border-b border-v-line pb-2">
                <ChefHat className="h-4 w-4 text-v-faint" />
                <h2 className="v-t-micro text-v-faint">02 — History</h2>
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
        "overflow-hidden rounded-v border bg-v-bg-raise transition-colors duration-300",
        order.status === "pending" ? "border-v-accent/30" : "border-v-line"
      )}
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 border-b border-v-line px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {/* Seat badge */}
          <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-v border border-v-line bg-white/[0.03]">
            <Hash className="mb-0 h-3 w-3 text-v-faint" />
            <span className="font-v-mono text-sm leading-none text-v-ink">{order.seatNumber}</span>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-v-ink">Table {order.seatNumber}</span>
              <span className={cn("v-t-micro flex items-center gap-1.5 rounded-v px-2 py-0.5", status.classes)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                {status.label}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-v-mono text-[11px] tabular-nums text-v-faint">{formatTime(order.createdAt)}</span>
              <span className="text-v-faint">·</span>
              <span className="text-[11px] text-v-faint">{formatRelativeTime(order.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Total */}
        <div className="shrink-0 text-right">
          <p className="mb-0.5 text-xs tabular-nums text-v-faint">
            {order.items.length} item{order.items.length !== 1 ? "s" : ""}
          </p>
          <p className="font-v-mono text-lg font-medium tabular-nums text-v-ink">
            ${(order.totalPrice / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Items breakdown */}
      <div className="px-4 py-4 sm:px-5">
        <div className="space-y-2.5">
          {order.items.map((item: any, idx: number) => (
            <div key={idx} className="flex items-start gap-3">
              {/* Quantity chip */}
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-v border border-v-line bg-white/[0.03] font-v-mono text-xs tabular-nums text-v-ink">
                {item.quantity}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-v-ink">{item.name}</p>
                  <p className="shrink-0 font-v-mono text-sm tabular-nums text-v-mut">
                    ${((item.price * item.quantity) / 100).toFixed(2)}
                  </p>
                </div>
                <p className="mt-0.5 text-[11px] tabular-nums text-v-faint">
                  ${(item.price / 100).toFixed(2)} each
                  {item.quantity > 1 && (
                    <span> · {item.quantity}×</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Subtotal breakdown */}
        <div className="mt-4 flex items-center justify-between border-t border-v-line pt-3">
          <span className="v-t-micro text-v-faint">Order Total</span>
          <span className="font-v-mono text-base font-medium tabular-nums text-v-ink">
            ${(order.totalPrice / 100).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Actions */}
      {order.status === "pending" && (
        <div className="flex gap-2 px-4 pb-4 sm:px-5">
          <button
            onClick={() => updateStatus({ orderId: order._id, status: "completed" })}
            className="v-press flex flex-1 items-center justify-center gap-2 rounded-v bg-v-accent px-4 py-2.5 text-sm font-semibold text-v-accent-ink transition-[filter] hover:brightness-95"
          >
            <CheckCircle className="h-4 w-4" />
            Mark Complete
          </button>
          <button
            onClick={() => updateStatus({ orderId: order._id, status: "cancelled" })}
            className="v-press flex items-center justify-center gap-2 rounded-v border border-red-400/25 bg-transparent px-4 py-2.5 text-sm font-medium text-red-400/90 transition-colors hover:bg-red-400/10"
          >
            <XCircle className="h-4 w-4" />
            Cancel
          </button>
        </div>
      )}

      {order.status === "completed" && order.completedAt && (
        <div className="px-5 pb-4">
          <p className="font-v-mono text-[11px] tabular-nums text-v-faint">
            Completed at {formatTime(order.completedAt)}
          </p>
        </div>
      )}
    </div>
  );
}
