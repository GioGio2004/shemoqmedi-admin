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
import { gel, tName, datetimeLocalToEpoch, toDatetimeLocal, discountPct } from "./lib";

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

// Defaults produce datetime-local strings ("YYYY-MM-DDTHH:mm"). Start = next
// full hour, end = +2h — both roll to tomorrow's date automatically if that
// crosses midnight, so overnight pickup windows just work.
const defaultStart = () => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toDatetimeLocal(d);
};
const defaultEnd = () => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 3);
  return toDatetimeLocal(d);
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
    const pickupStart = datetimeLocalToEpoch(startTime);
    const pickupEnd = datetimeLocalToEpoch(endTime);
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
    "w-full rounded-v border border-v-line bg-white/[0.03] px-3 py-2.5 text-sm text-v-ink placeholder:text-v-faint outline-none transition-colors focus:border-v-accent focus:bg-white/[0.05]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto overscroll-y-contain rounded-v border border-v-line bg-v-bg-raise p-0 text-v-ink shadow-none ring-0">
        <DialogHeader className="border-b border-v-line px-5 pb-4 pt-5">
          <p className="v-t-micro text-v-faint">Surprise Bags</p>
          <DialogTitle className="font-v-display text-lg font-medium tracking-tight text-v-ink">
            Post a bag
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-5 pb-5">
          {/* Mode tabs */}
          <div className="grid grid-cols-3 divide-x divide-v-line overflow-hidden rounded-v border border-v-line">
            {modeTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setMode(t.key)}
                className={cn(
                  "v-t-micro v-press flex items-center justify-center gap-1.5 px-2 py-2.5 transition-colors",
                  mode === t.key
                    ? "bg-white/[0.05] text-v-accent"
                    : "text-v-mut hover:text-v-ink",
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
                <div className="h-16 animate-pulse rounded-v border border-v-line bg-white/[0.03]" />
              ) : templates.length === 0 ? (
                <p className="rounded-v border border-dashed border-v-line px-4 py-6 text-center text-xs text-v-faint">
                  No templates yet. Compose a bag and tick &quot;save as
                  template&quot; to reuse it next time.
                </p>
              ) : (
                templates.map((tpl) => (
                  <button
                    key={tpl._id}
                    onClick={() => setTemplateId(tpl._id)}
                    className={cn(
                      "v-press flex w-full items-center justify-between gap-3 rounded-v border px-4 py-3 text-left transition-colors",
                      templateId === tpl._id
                        ? "border-v-accent bg-v-accent/[0.06]"
                        : "border-v-line bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-v-ink">
                        {tName(tpl.title)}
                      </p>
                      <p className="font-v-mono text-xs tabular-nums text-v-faint">
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
                          ? "border-v-accent bg-v-accent"
                          : "border-v-line",
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
                  <div className="h-16 animate-pulse rounded-v border border-v-line bg-white/[0.03]" />
                ) : menuItems.length === 0 ? (
                  <p className="rounded-v border border-dashed border-v-line px-4 py-6 text-center text-xs text-v-faint">
                    Your menu is empty — use the Custom tab instead.
                  </p>
                ) : (
                  menuItems.map((item) => {
                    const qty = selectedItems[item._id] ?? 0;
                    return (
                      <div
                        key={item._id}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-v border px-3 py-2.5",
                          qty > 0
                            ? "border-v-accent/50 bg-v-accent/[0.05]"
                            : "border-v-line bg-white/[0.02]",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-v-ink">
                            {tName(item.name)}
                          </p>
                          <p className="font-v-mono text-xs tabular-nums text-v-faint">
                            {gel(item.price)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {qty > 0 && (
                            <>
                              <button
                                onClick={() => setItemQty(item._id, -1)}
                                className="v-press flex h-7 w-7 items-center justify-center rounded-full border border-v-line text-v-mut transition-colors hover:bg-white/[0.06]"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="w-5 text-center font-v-mono text-sm font-medium tabular-nums text-v-ink">
                                {qty}
                              </span>
                            </>
                          )}
                          <button
                            onClick={() => setItemQty(item._id, 1)}
                            className="v-press flex h-7 w-7 items-center justify-center rounded-full border border-v-accent/40 bg-v-accent/10 text-v-accent transition-colors hover:bg-v-accent/20"
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
                <label className="v-t-micro mb-1 block text-v-faint">
                  Bag title (optional)
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Surprise Bag"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center justify-between rounded-v border border-v-line bg-white/[0.03] px-4 py-2.5 text-sm">
                <span className="text-v-mut">Original value (auto)</span>
                <span className="font-v-mono font-medium tabular-nums text-v-ink">
                  {gel(menuOriginalValue)}
                </span>
              </div>
            </div>
          )}

          {/* ── Free-form ───────────────────────────────────────────────── */}
          {mode === "freeform" && (
            <div className="space-y-3">
              <div>
                <label className="v-t-micro mb-1 block text-v-faint">
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
                <label className="v-t-micro mb-1 block text-v-faint">
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
          <div className="space-y-3 border-t border-v-line pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="v-t-micro mb-1 block text-v-faint">
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
                  <p className="v-t-micro mt-1 tabular-nums text-v-mut">
                    {pct}% off the original value
                  </p>
                )}
              </div>
              <div>
                <label className="v-t-micro mb-1 block text-v-faint">
                  Quantity today
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="v-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-v-line text-v-mut transition-colors hover:bg-white/[0.06]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="flex-1 text-center font-v-mono text-lg font-medium tabular-nums text-v-ink">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity((q) => q + 1)}
                    className="v-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-v-line text-v-mut transition-colors hover:bg-white/[0.06]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="v-t-micro mb-1 block text-v-faint">
                  Pickup from
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  min={toDatetimeLocal(new Date())}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    // Keep end ≥ start: if the new start passes the end, push
                    // end to +2h so the overnight case never inverts.
                    const s = datetimeLocalToEpoch(e.target.value);
                    const en = datetimeLocalToEpoch(endTime);
                    if (s && (!en || en <= s)) {
                      setEndTime(toDatetimeLocal(new Date(s + 2 * 60 * 60 * 1000)));
                    }
                  }}
                  className={cn(inputCls, "[color-scheme:dark]")}
                />
              </div>
              <div>
                <label className="v-t-micro mb-1 block text-v-faint">
                  Pickup until
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  min={startTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={cn(inputCls, "[color-scheme:dark]")}
                />
              </div>
            </div>

            {mode !== "template" && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-v border border-v-line bg-white/[0.02] px-4 py-3">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="h-4 w-4 accent-[#D8FF3A]"
                />
                <span className="text-sm text-v-mut">
                  Save as template for one-tap posting
                </span>
              </label>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="v-press flex w-full items-center justify-center gap-2 rounded-v bg-v-accent py-3 text-sm font-semibold text-v-accent-ink transition-[filter] duration-150 ease-out hover:brightness-95 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Posting…" : "Post bag — go live"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
