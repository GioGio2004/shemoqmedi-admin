"use client";

import { useOrganization } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2, ShoppingBag, CheckCircle, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <div className="space-y-6 max-w-5xl text-zinc-50 pb-20">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="h-4 w-4 text-white" />
            <h1 className="text-3xl font-medium tracking-tight text-white">Orders</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Real-time orders placed by customers at {organization?.name}.
          </p>
        </div>
      </div>

      <div className="grid gap-4 mt-6">
        {orders.length === 0 ? (
          <div className="p-12 border border-white/5 bg-white/[0.02] rounded-2xl flex flex-col items-center text-center">
            <ShoppingBag className="w-12 h-12 text-zinc-700 mb-4" />
            <p className="text-zinc-400 font-medium text-lg">No orders yet</p>
            <p className="text-sm text-zinc-500">When customers place an order from the public menu, it will appear here.</p>
          </div>
        ) : (
          orders.map((order) => (
            <div key={order._id} className="p-6 border border-white/10 bg-[#09090b] rounded-2xl flex flex-col md:flex-row gap-6 items-start md:items-center">
              
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm font-bold">
                    #{order.seatNumber}
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white">Seat {order.seatNumber}</h3>
                    <p className="text-xs text-zinc-500">
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  
                  <div className={cn(
                    "ml-auto md:ml-4 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    order.status === "pending" ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
                    order.status === "completed" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" :
                    "bg-red-500/10 text-red-500 border border-red-500/20"
                  )}>
                    {order.status}
                  </div>
                </div>

                <div className="space-y-2 bg-white/5 rounded-xl p-4 border border-white/5">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-3 text-zinc-300">
                        <span className="font-bold text-white w-6">{item.quantity}x</span>
                        <span>{item.name}</span>
                      </div>
                      <span className="font-mono text-zinc-400 font-medium">
                        ${(item.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="pt-3 mt-3 border-t border-white/10 flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Total</span>
                    <span className="text-base font-black font-mono text-white">${order.totalPrice.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto shrink-0">
                {order.status === "pending" && (
                  <>
                    <button
                      onClick={() => updateStatus({ orderId: order._id, status: "completed" })}
                      className="flex-1 md:w-32 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 text-emerald-950 font-bold text-sm transition-all hover:bg-emerald-400"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Complete
                    </button>
                    <button
                      onClick={() => updateStatus({ orderId: order._id, status: "cancelled" })}
                      className="flex-1 md:w-32 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-transparent border border-red-500/30 text-red-400 font-bold text-sm transition-all hover:bg-red-500/10"
                    >
                      <XCircle className="w-4 h-4" />
                      Cancel
                    </button>
                  </>
                )}
                {order.status === "completed" && (
                  <p className="text-xs text-center w-full md:w-32 py-2 text-zinc-500 font-medium">Order Completed</p>
                )}
                {order.status === "cancelled" && (
                  <p className="text-xs text-center w-full md:w-32 py-2 text-zinc-500 font-medium">Order Cancelled</p>
                )}
              </div>

            </div>
          ))
        )}
      </div>
    </div>
  );
}
