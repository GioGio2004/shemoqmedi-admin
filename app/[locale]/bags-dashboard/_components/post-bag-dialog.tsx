"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  LayoutTemplate,
  UtensilsCrossed,
  PenLine,
  Minus,
  Plus,
  Loader2,
} from "lucide-react";
import { gel, tName, timeToEpochToday, discountPct } from "./lib";

type Mode = "template" | "menu" | "freeform";

function errMsg(e: unknown): string {
  return e instanceof ConvexError && typeof e.data === "string"
    ? e.data
    : "Something went wrong. Please try again.";
}

/** "12.5" GEL string → tetri (int) or null */
function gelToTetri(s: string): number | null {
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const defaultEnd = () => {
  const d = new Date();
  d.setHours(Math.min(d.getHours() + 3, 23), 0, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
};
const defaultStart = () => {
  const d = new Date();
  d.setHours(Math.min(d.getHours() + 1, 22), 0, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
};

export function PostBagDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const skip = !isAuthenticated || !open;
  const templates = useQuery(
    api.surpriseBags.listTemplates,
    skip ? "skip" : { orgId },
  );
  const menuItems = useQuery(
    api.menuItems.listByOrg,
    skip ? "skip" : { orgId },
  );
  const postBag = useMutation(api.surpriseBags.postBag);
  const upsertTemplate = useMutation(api.surpriseBags.upsertTemplate);

  // ── Form state ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("template");
  const [templateId, setTemplateId] = useState<Id<"surpriseBags"> | null>(null);
  const [selectedItems, setSelectedItems] = useState<
    Record<string, number> // menuItemId → quantity
  >({});
  const [title, setTitle] = useState("");
  const [originalValueGel, setOriginalValueGel] = useState("");
  const [priceGel, setPriceGel] = useState("");
  const [quantity, setQuantity] = useState(3);
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedTemplate = (templates ?? []).find(
    (t) => t._id === templateId,
  );

  // Auto-summed original value when composing from menu items (tetri)
  const menuOriginalValue = useMemo(() => {
    let sum = 0;
    for (const [id, qty] of Object.entries(selectedItems)) {
      const item = (menuItems ?? []).find((m) => m._id === id);
      if (item) sum += item.price * qty;
    }
    return sum;
  }, [selectedItems, menuItems]);

  const effectiveOriginalValue =
    mode === "template"
      ? (selectedTemplate?.originalValue ?? 0)
      : mode === "menu"
        ? menuOriginalValue
        : (gelToTetri(originalValueGel) ?? 0);

  const priceTetri =
    mode === "template" && priceGel === ""
      ? (selectedTemplate?.price ?? null)
      : gelToTetri(priceGel);

  const pct =
    priceTetri && effectiveOriginalValue > 0
      ? discountPct(effectiveOriginalValue, priceTetri)
      : null;

  const setItemQty = (id: string, delta: number) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      const qty = (next[id] ?? 0) + delta;
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };

  const reset = () => {
    setMode("template");
    setTemplateId(null);
    setSelectedItems({});
    setTitle("");
    setOriginalValueGel("");
    setPriceGel("");
    setQuantity(3);
    setStartTime(defaultStart());
    setEndTime(defaultEnd());
    setSaveAsTemplate(false);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const pickupStart = timeToEpochToday(startTime);
    const pickupEnd = timeToEpochToday(endTime);
    if (!pickupStart || !pickupEnd) {
      toast.error("Set a valid pickup window.");
      return;
    }
    if (pickupEnd <= pickupStart) {
      toast.error("Pickup end must be after start.");
      return;
    }
    if (quantity < 1) {
      toast.error("Quantity must be at least 1.");
      return;
    }

    // Build fields per mode
    let args: Parameters<typeof postBag>[0];
    if (mode === "template") {
      if (!templateId) {
        toast.error("Pick a template first.");
        return;
      }
      args = {
        orgId,
        templateId,
        quantity,
        pickupStart,
        pickupEnd,
        ...(priceGel !== "" && priceTetri ? { price: priceTetri } : {}),
      };
    } else {
      if (priceTetri === null || priceTetri <= 0) {
        toast.error("Set a bag price.");
        return;
      }
      if (effectiveOriginalValue <= priceTetri) {
        toast.error("Price must be below the original value.");
        return;
      }
      const items =
        mode === "menu"
          ? Object.entries(selectedItems).map(([id, qty]) => {
              const item = (menuItems ?? []).find((m) => m._id === id)!;
              return {
                menuItemId: item._id,
                name: item.name,
                quantity: qty,
                menuPrice: item.price,
              };
            })
          : undefined;
      if (mode === "menu" && (!items || items.length === 0)) {
        toast.error("Select at least one menu item.");
        return;
      }
      const bagTitle =
        title.trim() !== ""
          ? { en: title.trim() }
          : mode === "menu"
            ? { en: "Surprise Bag" }
            : null;
      if (!bagTitle) {
        toast.error("Give the bag a title.");
        return;
      }
      args = {
        orgId,
        title: bagTitle,
        items,
        originalValue: effectiveOriginalValue,
        price: priceTetri,
        quantity,
        pickupStart,
        pickupEnd,
      };
    }

    setSubmitting(true);
    try {
      if (saveAsTemplate && mode !== "template") {
        await upsertTemplate({
          orgId,
          title: args.title!,
          items: args.items,
          originalValue: args.originalValue!,
          price: args.price!,
        });
      }
      await postBag(args);
      toast.success("Bag is live! Customers can reserve it now.");
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const modeTabs = [
    { key: "template" as const, label: "Template", icon: LayoutTemplate },
    { key: "menu" as const, label: "From menu", icon: UtensilsCrossed },
    { key: "freeform" as const, label: "Custom", icon: PenLine },
  ];

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-emerald-400/40 focus:bg-white/[0.07]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto overscroll-y-contain border-white/10 border-t-white/20 bg-[#0b0b0d]/90 p-0 text-zinc-50 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-xl backdrop-saturate-150 sm:rounded-3xl">
        <DialogHeader className="border-b border-white/10 px-5 pb-4 pt-5">
          <DialogTitle className="text-lg font-semibold tracking-tight text-white">
            Post a bag
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-5 pb-5">
          {/* Mode tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 border-t-white/20 bg-white/[0.06] p-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)] backdrop-blur-xl backdrop-saturate-150">
            {modeTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setMode(t.key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none",
                  mode === t.key
                    ? "bg-white/15 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)] ring-1 ring-white/20"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Template picker ─────────────────────────────────────────── */}
          {mode === "template" && (
            <div className="space-y-2">
              {templates === undefined ? (
                <div className="h-16 animate-pulse rounded-xl bg-white/5" />
              ) : templates.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
                  No templates yet. Compose a bag and tick &quot;save as
                  template&quot; to reuse it next time.
                </p>
              ) : (
                templates.map((tpl) => (
                  <button
                    key={tpl._id}
                    onClick={() => setTemplateId(tpl._id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none",
                      templateId === tpl._id
                        ? "border-emerald-400/50 bg-emerald-400/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {tName(tpl.title)}
                      </p>
                      <p className="text-xs tabular-nums text-zinc-500">
                        {gel(tpl.price)}{" "}
                        <span className="line-through">
                          {gel(tpl.originalValue)}
                        </span>
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-4 w-4 shrink-0 rounded-full border",
                        templateId === tpl._id
                          ? "border-emerald-300 bg-emerald-300"
                          : "border-zinc-600",
                      )}
                    />
                  </button>
                ))
              )}
            </div>
          )}

          {/* ── Menu item composer ──────────────────────────────────────── */}
          {mode === "menu" && (
            <div className="space-y-3">
              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {menuItems === undefined ? (
                  <div className="h-16 animate-pulse rounded-xl bg-white/5" />
                ) : menuItems.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
                    Your menu is empty — use the Custom tab instead.
                  </p>
                ) : (
                  menuItems.map((item) => {
                    const qty = selectedItems[item._id] ?? 0;
                    return (
                      <div
                        key={item._id}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5",
                          qty > 0
                            ? "border-emerald-400/40 bg-emerald-400/[0.07]"
                            : "border-white/10 bg-white/[0.03]",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white">
                            {tName(item.name)}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {gel(item.price)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {qty > 0 && (
                            <>
                              <button
                                onClick={() => setItemQty(item._id, -1)}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition-[background-color,transform] duration-150 ease-out hover:bg-white/10 active:scale-[0.97] motion-reduce:transform-none"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="w-5 text-center text-sm font-semibold text-white">
                                {qty}
                              </span>
                            </>
                          )}
                          <button
                            onClick={() => setItemQty(item._id, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 transition-[background-color,transform] duration-150 ease-out hover:bg-emerald-400/20 active:scale-[0.97] motion-reduce:transform-none"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Bag title (optional)
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Surprise Bag"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5 text-sm">
                <span className="text-zinc-400">Original value (auto)</span>
                <span className="font-semibold tabular-nums text-white">
                  {gel(menuOriginalValue)}
                </span>
              </div>
            </div>
          )}

          {/* ── Free-form ───────────────────────────────────────────────── */}
          {mode === "freeform" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Bag title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Pastry surprise"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Original value (₾)
                </label>
                <input
                  value={originalValueGel}
                  onChange={(e) => setOriginalValueGel(e.target.value)}
                  inputMode="decimal"
                  placeholder="30.00"
                  className={inputCls}
                />
              </div>
            </div>
          )}

          {/* ── Shared: price / quantity / window ───────────────────────── */}
          <div className="space-y-3 border-t border-white/10 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Bag price (₾)
                </label>
                <input
                  value={priceGel}
                  onChange={(e) => setPriceGel(e.target.value)}
                  inputMode="decimal"
                  placeholder={
                    mode === "template" && selectedTemplate
                      ? (selectedTemplate.price! / 100).toFixed(2)
                      : "9.90"
                  }
                  className={inputCls}
                />
                {pct !== null && pct > 0 && (
                  <p className="mt-1 text-[11px] font-semibold tabular-nums text-emerald-400">
                    {pct}% off the original value
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Quantity today
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition-[background-color,transform] duration-150 ease-out hover:bg-white/10 active:scale-[0.97] motion-reduce:transform-none"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="flex-1 text-center text-lg font-semibold tabular-nums text-white">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity((q) => q + 1)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition-[background-color,transform] duration-150 ease-out hover:bg-white/10 active:scale-[0.97] motion-reduce:transform-none"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Pickup from
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={cn(inputCls, "[color-scheme:dark]")}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Pickup until
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={cn(inputCls, "[color-scheme:dark]")}
                />
              </div>
            </div>

            {mode !== "template" && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="h-4 w-4 accent-emerald-400"
                />
                <span className="text-sm text-zinc-300">
                  Save as template for one-tap posting
                </span>
              </label>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-semibold text-black shadow-[0_8px_24px_rgba(255,255,255,0.12)] transition-[background-color,transform,box-shadow] duration-150 ease-out hover:bg-zinc-200 active:scale-[0.97] disabled:opacity-60 motion-reduce:transform-none"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Posting…" : "Post bag — go live"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
