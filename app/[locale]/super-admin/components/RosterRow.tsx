"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, LogIn, Mail, UserCircle, Loader2 } from "lucide-react";
import { impersonateUserAction } from "../actions";
import { toast } from "sonner";

// ── Feature metadata ──────────────────────────────────────────────────────────
const FEATURES = [
  { key: "hasAiManager",    label: "AI Manager" },
  { key: "hasDigitalMenu",  label: "Digital Menu" },
  { key: "hasLiveOrdering", label: "Live Ordering" },
  { key: "hasNfcHardware",  label: "NFC Hardware" },
  { key: "hasCustomDomain", label: "Custom Domain" },
] as const;

type FeatureKey = (typeof FEATURES)[number]["key"];

// ── Role badge color ──────────────────────────────────────────────────────────
function roleClass(role: string) {
  const r = role?.replace("org:", "") || "";
  if (r === "owner") return "text-white bg-white/10 border-white/20";
  if (r === "manager") return "text-zinc-300 bg-white/5 border-white/10";
  return "text-zinc-500 bg-transparent border-white/8";
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      disabled={disabled}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 ${
        enabled ? "bg-white" : "bg-white/15"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-black transition-transform duration-200 ${
          enabled ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ── Member card ───────────────────────────────────────────────────────────────
function MemberCard({
  member,
  orgClerkId,
}: {
  member: any;
  orgClerkId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [updatingRole, setUpdatingRole] = useState(false);
  const updateCustomRole = useMutation(api.memberships.updateCustomRole);

  const handleImpersonate = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("targetUserId", member.externalId);
      const { url } = await impersonateUserAction(fd);
      if (url) window.location.href = url;
    } catch {
      toast.error("Failed to impersonate user.");
    } finally {
      setLoading(false);
    }
  };

  const currentRole = member.customRole || member.membershipRole || "";

  return (
    <div className="p-3 rounded-lg border border-white/8 bg-white/[0.02] space-y-2.5">
      <div className="flex items-center gap-2.5">
        {member.profilePicture ? (
          <img
            src={member.profilePicture}
            alt={member.name}
            className="h-8 w-8 rounded-full object-cover border border-white/10 shrink-0"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
            <UserCircle className="h-4 w-4 text-zinc-600" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-white truncate">
            {member.name} {member.lastname}
          </p>
          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500">
            <Mail className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{member.email}</span>
          </div>
        </div>
        <select
          value={currentRole}
          onClick={(e) => e.stopPropagation()}
          onChange={async (e) => {
            e.stopPropagation();
            setUpdatingRole(true);
            try {
              await updateCustomRole({
                userId: member.externalId,
                orgId: orgClerkId,
                customRole: e.target.value,
              });
            } catch {
              toast.error("Failed to update role.");
            } finally {
              setUpdatingRole(false);
            }
          }}
          disabled={updatingRole}
          className={`text-[10px] uppercase font-mono tracking-wider px-2 py-1 rounded-md border appearance-none cursor-pointer focus:outline-none transition-all disabled:opacity-50 ${roleClass(currentRole)}`}
          style={{ textAlignLast: "center" }}
        >
          <option value="" disabled>Role</option>
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="barista">Barista</option>
          <option value="server">Server</option>
        </select>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); handleImpersonate(); }}
        disabled={loading}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 border border-white/8 hover:border-white/15 transition-all"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <LogIn className="h-3 w-3" />
        )}
        Impersonate
      </button>
    </div>
  );
}

// ── Main row ──────────────────────────────────────────────────────────────────
export function RosterRow({ org }: { org: any }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [savingFeature, setSavingFeature] = useState<FeatureKey | null>(null);
  const updateFeatures = useMutation(api.organizations.updateFeatures);

  // Compute current feature state from the live org prop
  const features: Record<FeatureKey, boolean> = {
    hasAiManager:    org.features?.hasAiManager    ?? true,
    hasDigitalMenu:  org.features?.hasDigitalMenu  ?? false,
    hasLiveOrdering: org.features?.hasLiveOrdering ?? false,
    hasNfcHardware:  org.features?.hasNfcHardware  ?? false,
    hasCustomDomain: org.features?.hasCustomDomain ?? false,
  };

  const toggleFeature = async (key: FeatureKey) => {
    if (savingFeature) return;
    setSavingFeature(key);
    try {
      await updateFeatures({
        orgId: org.clerkId,
        features: { ...features, [key]: !features[key] },
      });
    } catch {
      toast.error("Failed to update feature.");
    } finally {
      setSavingFeature(null);
    }
  };

  return (
    <>
      {/* ── Org row ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
        onClick={() => setIsExpanded((v) => !v)}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-white">
          {org.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">{org.name}</p>
          {org.slug && (
            <p className="text-[10px] font-mono text-zinc-600 mt-0.5 truncate">/{org.slug}</p>
          )}
        </div>
        <span className="text-xs text-zinc-500 tabular-nums shrink-0">
          {org.members?.length ?? 0}
        </span>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="shrink-0 text-zinc-600"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.div>
      </div>

      {/* ── Expanded panel ── */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 space-y-4 border-t border-white/8 bg-white/[0.01]">

              {/* Members grid */}
              {org.members && org.members.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">
                    Staff
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {org.members.map((member: any) => (
                      <MemberCard
                        key={member.externalId}
                        member={member}
                        orgClerkId={org.clerkId}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-600">No members in this workspace.</p>
              )}

              {/* Features */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">
                  Features
                </p>
                <div className="grid gap-px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border border-white/8 rounded-lg overflow-hidden">
                  {FEATURES.map((feat, idx) => (
                    <div
                      key={feat.key}
                      className={`flex items-center justify-between px-3 py-2.5 bg-black hover:bg-white/[0.02] transition-colors ${
                        idx !== FEATURES.length - 1 ? "border-b border-white/8 sm:border-b-0 sm:border-r" : ""
                      }`}
                      style={{ borderColor: "rgba(255,255,255,0.06)" }}
                    >
                      <span className="text-xs text-zinc-300">{feat.label}</span>
                      <Toggle
                        enabled={features[feat.key]}
                        onChange={() => toggleFeature(feat.key)}
                        disabled={savingFeature === feat.key}
                      />
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
