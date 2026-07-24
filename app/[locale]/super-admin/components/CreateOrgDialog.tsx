"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X, Building2, Loader2 } from "lucide-react";
import { createOrganizationAction } from "../actions";
import { useSwitchIntoOrg } from "./useSwitchIntoOrg";

const inputCls =
  "w-full bg-v-bg border border-v-line rounded-v px-3 py-2.5 text-sm text-v-ink placeholder:text-v-faint outline-none focus:border-v-faint transition-colors";

/** Mirror of Clerk's slugification, for the mono preview only. */
function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * "Create organization" primary button + RULED dialog.
 * Creating via Clerk makes the super admin the org's first admin member
 * (`createdBy`); the Clerk webhook syncs the new org to Convex.
 */
export function CreateOrgDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const { switchIntoOrg } = useSwitchIntoOrg();

  const slugPreview = slugify(slug || name);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setName("");
    setSlug("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Organization name is required.");
      return;
    }
    setBusy(true);
    try {
      const result = await createOrganizationAction({
        name: name.trim(),
        slug: slug.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { organizationId, name: createdName } = result;
      toast.success(`Organization "${createdName}" created`, {
        duration: 10000,
        action: {
          label: "Switch into it",
          onClick: () => switchIntoOrg(organizationId, createdName),
        },
      });
      setOpen(false);
      setName("");
      setSlug("");
    } catch (err: unknown) {
      toast.error(
        (err as Error).message ?? "Failed to create organization."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Primary trigger — accent = the one primary action in the header */}
      <button
        onClick={() => setOpen(true)}
        className="v-t-micro v-press flex shrink-0 items-center gap-1.5 rounded-v bg-v-accent px-3 py-2 text-v-accent-ink transition-opacity hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" />
        Create organization
      </button>

      {/* RULED dialog — flat surfaces, hairlines, no glass/blur */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create organization"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/70"
            onClick={close}
            aria-hidden
          />
          <div className="relative w-full max-w-sm rounded-v border border-v-line bg-v-bg-raise">
            <div className="flex items-center justify-between border-b border-v-line px-4 py-3">
              <p className="v-t-micro text-v-faint">01.0 — New workspace</p>
              <button
                onClick={close}
                aria-label="Close"
                className="v-press rounded-v p-1 text-v-faint transition-colors hover:text-v-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-4">
              <div>
                <p className="v-t-micro mb-1.5 text-v-faint">Name</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Cafe Leila"
                  autoFocus
                  className={inputCls}
                />
              </div>

              <div>
                <p className="v-t-micro mb-1.5 text-v-faint">
                  Slug — optional
                </p>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="auto-generated if empty"
                  className={`${inputCls} font-v-mono`}
                />
                {slugPreview && (
                  <code className="mt-1.5 block truncate font-v-mono text-[10px] text-v-faint">
                    /{slugPreview}
                  </code>
                )}
              </div>

              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="v-t-micro v-press flex w-full items-center justify-center gap-2 rounded-v bg-v-accent py-3 text-v-accent-ink disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Building2 className="h-4 w-4" />
                )}
                {busy ? "Creating…" : "Create organization"}
              </button>

              <p className="v-t-micro text-v-faint">
                Creating an org makes you its first admin. The Clerk webhook
                syncs it to Convex automatically.
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
