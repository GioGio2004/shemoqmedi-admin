"use client";

import { useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ImageUploader } from "@/components/ImageUploader";
import { MenuImage } from "@/components/MenuImage";
import {
  UtensilsCrossed,
  Plus,
  ChevronRight,
  ChevronDown,
  Pencil,
  Archive,
  ImageIcon,
  Loader2,
  Tag,
  Check,
  X,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert GEL float string to tetri integer, e.g. "5.50" → 550 */
function gelToTetri(gel: string): number {
  return Math.round(parseFloat(gel) * 100);
}

/** Convert tetri integer to GEL string, e.g. 550 → "5.50" */
function tetriToGel(tetri: number): string {
  return (tetri / 100).toFixed(2);
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = {
  _id: Id<"categories">;
  name: Record<string, string>;
  sortOrder: number;
  isActive: boolean;
};

type MenuItem = {
  _id: Id<"menuItems">;
  name: Record<string, string>;
  description?: Record<string, string>;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  sortOrder: number;
  tags?: string[];
  categoryId: Id<"categories">;
  orgId: string;
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <div className="h-16 w-16 rounded-2xl bg-white/5 dark:bg-white/5 bg-zinc-100 border border-border flex items-center justify-center">
        <UtensilsCrossed className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium text-foreground text-lg">No categories yet</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
          Create your first category (e.g. "Coffee", "Food") to start building
          your menu.
        </p>
      </div>
      <Button
        onClick={onAdd}
        className="bg-foreground text-background hover:opacity-90 transition-all font-medium rounded-lg"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Category
      </Button>
    </div>
  );
}

// ─── Category Form Dialog ─────────────────────────────────────────────────────

function CategoryDialog({
  open,
  onClose,
  orgId,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  existing?: Category;
}) {
  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);
  const [nameEn, setNameEn] = useState(existing?.name?.en ?? "");
  const [nameKa, setNameKa] = useState(existing?.name?.ka ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!nameEn.trim()) return;
    setSaving(true);
    try {
      const name: Record<string, string> = { en: nameEn.trim() };
      if (nameKa.trim()) name.ka = nameKa.trim();

      if (existing) {
        await updateCategory({ orgId, categoryId: existing._id, name });
      } else {
        await createCategory({ orgId, name });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md bg-[#09090b] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">
            {existing ? "Edit Category" : "New Category"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-xs font-medium">
              Name (English) *
            </Label>
            <Input
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="e.g. Hot Drinks"
              className="bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-xs font-medium">
              Name (Georgian)
            </Label>
            <Input
              value={nameKa}
              onChange={(e) => setNameKa(e.target.value)}
              placeholder="e.g. ცხელი სასმელები"
              className="bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-zinc-400 hover:text-white hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !nameEn.trim()}
            className="bg-white text-black hover:bg-zinc-200 font-medium"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {existing ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Menu Item Form Dialog ────────────────────────────────────────────────────

function MenuItemDialog({
  open,
  onClose,
  orgId,
  cafeName,
  categoryId,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  cafeName: string;
  categoryId: Id<"categories">;
  existing?: MenuItem;
}) {
  const createItem = useMutation(api.menuItems.create);
  const updateItem = useMutation(api.menuItems.update);

  const [nameEn, setNameEn] = useState(existing?.name?.en ?? "");
  const [nameKa, setNameKa] = useState(existing?.name?.ka ?? "");
  const [descEn, setDescEn] = useState(existing?.description?.en ?? "");
  const [descKa, setDescKa] = useState(existing?.description?.ka ?? "");
  const [priceGel, setPriceGel] = useState(
    existing ? tetriToGel(existing.price) : "",
  );
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl ?? "");
  const [saving, setSaving] = useState(false);

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }

  async function handleSave() {
    if (!nameEn.trim() || !priceGel) return;
    setSaving(true);
    try {
      const name: Record<string, string> = { en: nameEn.trim() };
      if (nameKa.trim()) name.ka = nameKa.trim();
      const description: Record<string, string> | undefined = descEn.trim()
        ? { en: descEn.trim(), ...(descKa.trim() ? { ka: descKa.trim() } : {}) }
        : undefined;
      const price = gelToTetri(priceGel);

      if (existing) {
        await updateItem({
          orgId,
          menuItemId: existing._id,
          name,
          description,
          price,
          imageUrl: imageUrl || undefined,
          tags: tags.length ? tags : undefined,
        });
      } else {
        await createItem({
          orgId,
          categoryId,
          name,
          description,
          price,
          imageUrl: imageUrl || undefined,
          tags: tags.length ? tags : undefined,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* OPTIMIZED FOR DESKTOP:
        Increased max-width to md:max-w-2xl lg:max-w-3xl. 
        Added p-6 for better breathing room on larger displays.
      */}
      <DialogContent className="w-[95vw] sm:w-full md:max-w-2xl lg:max-w-3xl bg-[#09090b] border-white/10 text-white max-h-[90dvh] overflow-y-auto p-4 md:p-6 lg:p-8">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-white text-xl">
            {existing ? "Edit Menu Item" : "New Menu Item"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Names */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs font-medium">
                Name (EN) *
              </Label>
              <Input
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Flat White"
                className="bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs font-medium">
                Name (KA)
              </Label>
              <Input
                value={nameKa}
                onChange={(e) => setNameKa(e.target.value)}
                placeholder="ფლეთ ვაითი"
                className="bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30"
              />
            </div>
          </div>

          {/* Descriptions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs font-medium">
                Description (EN)
              </Label>
              <Textarea
                value={descEn}
                onChange={(e) => setDescEn(e.target.value)}
                placeholder="Smooth espresso with steamed milk."
                rows={3}
                className="bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30 resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs font-medium">
                Description (KA)
              </Label>
              <Textarea
                value={descKa}
                onChange={(e) => setDescKa(e.target.value)}
                placeholder="გლუვი ესპრესო ორთქლიანი რძით."
                rows={3}
                className="bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30 resize-none"
              />
            </div>
          </div>

          {/* Price & Tags (Side by side on desktop) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs font-medium">
                Price (GEL) *
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm font-medium">
                  ₾
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceGel}
                  onChange={(e) => setPriceGel(e.target.value)}
                  placeholder="5.50"
                  className="pl-7 bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs font-medium">Tags</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.preventDefault(), addTag())
                  }
                  placeholder="vegan, spicy, popular…"
                  className="flex-1 bg-white/5 border-white/20 text-white placeholder:text-zinc-600 focus-visible:ring-white/30"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTag}
                  className="border-white/20 text-zinc-300 hover:text-white hover:bg-white/5 h-9"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tags.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="gap-1 bg-white/10 text-white border-white/20 text-xs font-medium py-1 px-2"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => setTags(tags.filter((x) => x !== t))}
                        className="ml-0.5 text-zinc-400 hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Image Upload Area */}
          <div className="space-y-2 border border-white/10 rounded-xl p-5 bg-white/[0.02]">
            <Label className="text-zinc-300 text-xs font-medium flex items-center gap-1.5 mb-2">
              <ImageIcon className="h-4 w-4" />
              Product Photo
            </Label>
            <ImageUploader
              cafeName={cafeName}
              itemName={nameEn || "item"}
              onSuccess={(res) => setImageUrl(res.url ?? "")}
            />
            {imageUrl && (
              <div className="mt-4 rounded-xl overflow-hidden border border-white/10 w-32 h-32 relative shadow-xl shadow-black/50">
                <MenuImage
                  src={imageUrl.replace(
                    process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ?? "",
                    "",
                  )}
                  alt={nameEn}
                  width={128}
                  height={128}
                  className="object-cover w-full h-full"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2 pt-4 border-t border-white/10 mt-4">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-zinc-400 hover:text-white hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !nameEn.trim() || !priceGel}
            className="bg-white text-black hover:bg-zinc-200 font-medium px-8"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {existing ? "Save Changes" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Menu Item Card ───────────────────────────────────────────────────────────

function MenuItemCard({
  item,
  orgId,
  cafeName,
}: {
  item: MenuItem;
  orgId: string;
  cafeName: string;
}) {
  const archive = useMutation(api.menuItems.archive);
  const toggleAvailable = useMutation(api.menuItems.update);
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try {
      await toggleAvailable({
        orgId,
        menuItemId: item._id,
        isAvailable: !item.isAvailable,
      });
    } finally {
      setToggling(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-4 p-4 rounded-xl border transition-all",
          item.isAvailable
            ? "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
            : "border-white/5 bg-transparent opacity-50 hover:opacity-70",
        )}
      >
        {/* Image */}
        <div className="h-14 w-14 rounded-lg overflow-hidden border border-white/10 shrink-0 bg-white/5 flex items-center justify-center">
          {item.imageUrl ? (
            <MenuImage
              src={item.imageUrl.replace(
                process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ?? "",
                "",
              )}
              alt={item.name?.en ?? ""}
              width={56}
              height={56}
              className="object-cover w-full h-full"
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-zinc-600" />
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-white text-sm truncate">
              {item.name?.en}
            </p>
            {item.name?.ka && (
              <span className="text-xs text-zinc-500 truncate">
                {item.name.ka}
              </span>
            )}
          </div>
          {item.description?.en && (
            <p className="text-xs text-zinc-500 mt-0.5 truncate">
              {item.description.en}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-sm font-medium text-white tabular-nums">
              ₾ {tetriToGel(item.price)}
            </span>
            {item.tags?.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-white/15 text-zinc-400"
              >
                <Tag className="h-2.5 w-2.5 mr-1" />
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 transition-opacity shrink-0">
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={item.isAvailable ? "Mark unavailable" : "Mark available"}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
          >
            {toggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : item.isAvailable ? (
              <ToggleRight className="h-4 w-4 text-white" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => archive({ orgId, menuItemId: item._id })}
            title="Archive item"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <MenuItemDialog
          open={editing}
          onClose={() => setEditing(false)}
          orgId={orgId}
          cafeName={cafeName}
          categoryId={item.categoryId}
          existing={item}
        />
      )}
    </>
  );
}

// ─── Category Section ─────────────────────────────────────────────────────────

function CategorySection({
  category,
  orgId,
  cafeName,
  defaultExpanded = false,
}: {
  category: Category;
  orgId: string;
  cafeName: string;
  defaultExpanded?: boolean;
}) {
  const items = useQuery(api.menuItems.listByCategory, {
    orgId,
    categoryId: category._id,
  });
  const archiveCategory = useMutation(api.categories.archive);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [addingItem, setAddingItem] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);

  const available = items?.filter((i) => i.isAvailable).length ?? 0;
  const total = items?.length ?? 0;

  return (
    <>
      <Card className="bg-[#09090b] border-white/10 shadow-none overflow-hidden">
        {/* Category header */}
        <CardHeader className="p-0">
          <div className="flex items-center justify-between px-5 py-4">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-white text-sm">
                    {category.name?.en}
                  </h3>
                  {category.name?.ka && (
                    <span className="text-xs text-zinc-500">
                      · {category.name.ka}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {available}/{total} available
                </p>
              </div>
            </button>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAddingItem(true)}
                className="h-8 gap-1.5 text-xs text-zinc-400 hover:text-white hover:bg-white/5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </Button>
              <button
                onClick={() => setEditingCategory(true)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() =>
                  archiveCategory({ orgId, categoryId: category._id })
                }
                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </CardHeader>

        {/* Items */}
        {expanded && (
          <CardContent className="p-0">
            <div className="border-t border-white/5 px-4 py-3 space-y-2">
              {items === undefined ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-sm text-zinc-500">No items yet.</p>
                  <button
                    onClick={() => setAddingItem(true)}
                    className="mt-2 text-xs text-zinc-400 hover:text-white transition-colors underline underline-offset-2"
                  >
                    Add the first one
                  </button>
                </div>
              ) : (
                items.map((item) => (
                  <MenuItemCard
                    key={item._id}
                    item={item as MenuItem}
                    orgId={orgId}
                    cafeName={cafeName}
                  />
                ))
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Dialogs */}
      {addingItem && (
        <MenuItemDialog
          open={addingItem}
          onClose={() => setAddingItem(false)}
          orgId={orgId}
          cafeName={cafeName}
          categoryId={category._id}
        />
      )}
      {editingCategory && (
        <CategoryDialog
          open={editingCategory}
          onClose={() => setEditingCategory(false)}
          orgId={orgId}
          existing={category}
        />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const { organization, isLoaded } = useOrganization();
  const orgId = organization?.id;
  const cafeName = organization?.name ?? "cafe";
  const orgSlug = organization?.slug ?? null;

  // Build the public menu preview URL using the org's Clerk slug
  const previewUrl = orgSlug ? `/en/test-menu/${orgSlug}` : null;

  const categories = useQuery(api.categories.list, orgId ? { orgId } : "skip");

  const [addingCategory, setAddingCategory] = useState(false);
  const [expandKey, setExpandKey] = useState(0);
  const [globalExpanded, setGlobalExpanded] = useState(false);
  const [storefrontToggling, setStorefrontToggling] = useState(false);

  const setAllAvailability = useMutation(api.menuItems.setAllAvailability);

  async function hideAllFromStorefront() {
    if (!orgId) return;
    setStorefrontToggling(true);
    try {
      await setAllAvailability({ orgId, isAvailable: false });
    } finally {
      setStorefrontToggling(false);
    }
  }

  async function showAllOnStorefront() {
    if (!orgId) return;
    setStorefrontToggling(true);
    try {
      await setAllAvailability({ orgId, isAvailable: true });
    } finally {
      setStorefrontToggling(false);
    }
  }

  function expandAll() {
    setGlobalExpanded(true);
    setExpandKey((k) => k + 1);
  }

  function collapseAll() {
    setGlobalExpanded(false);
    setExpandKey((k) => k + 1);
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="font-medium text-foreground">No workspace selected</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          Select a workspace from the sidebar to manage its menu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-zinc-50">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <UtensilsCrossed className="h-4 w-4 text-white" />
            <h1 className="text-3xl font-medium tracking-tight text-white">
              Menu
            </h1>
            <Badge
              variant="outline"
              className="text-[10px] text-zinc-400 border-white/10 bg-white/5 font-medium ml-1"
            >
              {categories?.length ?? 0} categories
            </Badge>
          </div>
          <p className="text-sm text-zinc-400">
            Manage categories and items for{" "}
            <span className="text-white font-medium">{cafeName}</span>. Photos
            are served via ImageKit CDN.
          </p>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {previewUrl && (
            <Link
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-white/15 text-zinc-300 bg-white/[0.03] hover:bg-white/[0.08] hover:text-white hover:border-white/30 transition-all"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View Menu
            </Link>
          )}
          <Button
            variant="outline"
            onClick={hideAllFromStorefront}
            disabled={storefrontToggling}
            className="border-red-500/30 text-red-400 bg-red-500/[0.05] hover:bg-red-500/[0.15] hover:text-red-300 hover:border-red-500/50 font-medium rounded-lg shadow-none transition-all"
          >
            {storefrontToggling ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <EyeOff className="h-4 w-4 mr-2" />
            )}
            Hide All
          </Button>
          <Button
            variant="outline"
            onClick={showAllOnStorefront}
            disabled={storefrontToggling}
            className="border-emerald-500/30 text-emerald-400 bg-emerald-500/[0.05] hover:bg-emerald-500/[0.15] hover:text-emerald-300 hover:border-emerald-500/50 font-medium rounded-lg shadow-none transition-all"
          >
            {storefrontToggling ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            Show All
          </Button>
          <Button
            variant="outline"
            onClick={collapseAll}
            className="border-white/15 text-zinc-300 bg-white/[0.03] hover:bg-white/[0.08] hover:text-white hover:border-white/30 font-medium rounded-lg shadow-none"
          >
            <ChevronRight className="h-4 w-4 mr-2" />
            Collapse All
          </Button>
          <Button
            variant="outline"
            onClick={expandAll}
            className="border-white/15 text-zinc-300 bg-white/[0.03] hover:bg-white/[0.08] hover:text-white hover:border-white/30 font-medium rounded-lg shadow-none"
          >
            <ChevronDown className="h-4 w-4 mr-2" />
            Expand All
          </Button>
          <Button
            onClick={() => setAddingCategory(true)}
            className="bg-white text-black hover:bg-zinc-200 font-medium rounded-lg shadow-none"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Category
          </Button>
        </div>
      </div>

      {/* Categories */}
      {categories === undefined ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : categories.length === 0 ? (
        <EmptyState onAdd={() => setAddingCategory(true)} />
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both space-y-4">
          {categories.map((cat) => (
            <CategorySection
              key={`${cat._id}-${expandKey}`}
              category={cat as Category}
              orgId={orgId}
              cafeName={cafeName}
              defaultExpanded={globalExpanded}
            />
          ))}
        </div>
      )}

      {/* Add Category Dialog */}
      {addingCategory && (
        <CategoryDialog
          open={addingCategory}
          onClose={() => setAddingCategory(false)}
          orgId={orgId}
        />
      )}
    </div>
  );
}
