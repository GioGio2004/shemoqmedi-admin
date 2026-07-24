"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRightLeft,
  ChevronDown,
  LogIn,
  Mail,
  UserCircle,
  Loader2,
} from "lucide-react";
import { impersonateUserAction } from "../actions";
import { useSwitchIntoOrg } from "./useSwitchIntoOrg";
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

// ── Role badge tone — quiet hierarchy, no accent (not a live state) ───────────
function roleClass(role: string) {
  const r = role?.replace("org:", "") || "";
  if (r === "owner") return "text-v-ink border-v-faint";
  if (r === "manager") return "text-v-mut border-v-line";
  return "text-v-faint border-v-line";
}

// ── Toggle switch — accent = feature live ─────────────────────────────────────
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
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-v transition-colors focus:outline-none disabled:opacity-40 ${
        enabled ? "bg-v-accent" : "bg-v-line"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-[1px] bg-v-bg transition-transform ${
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
    <div className="space-y-2.5 rounded-v border border-v-line bg-v-bg p-3">
      <div className="flex items-center gap-2.5">
        {member.profilePicture ? (
          <img
            src={member.profilePicture}
            alt={member.name}
            className="h-8 w-8 shrink-0 rounded-v border border-v-line object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
            <UserCircle className="h-4 w-4 text-v-faint" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-v-ink">
            {member.name} {member.lastname}
          </p>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-v-faint">
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
          className={`v-t-micro cursor-pointer appearance-none rounded-v border bg-v-bg px-2 py-1 transition-colors focus:outline-none disabled:opacity-50 ${roleClass(currentRole)}`}
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
        className="v-t-micro v-press flex w-full items-center justify-center gap-1.5 rounded-v border border-v-line py-1.5 text-v-mut transition-colors hover:border-v-faint hover:text-v-ink"
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
  const { switchIntoOrg, switchingOrgId } = useSwitchIntoOrg();
  const isSwitching = switchingOrgId === org.clerkId;

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
        className="flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition-colors hover:bg-v-bg"
        onClick={() => setIsExpanded((v) => !v)}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-v border border-v-line bg-v-bg font-v-mono text-xs text-v-ink">
          {org.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-v-ink">{org.name}</p>
          {org.slug && (
            <p className="mt-0.5 truncate font-v-mono text-[10px] text-v-faint">/{org.slug}</p>
          )}
        </div>
        <span className="shrink-0 font-v-mono text-xs tabular-nums text-v-mut">
          {org.members?.length ?? 0}
        </span>
        {/* Switch — join as org:admin (idempotent), setActive, land in /dashboard */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            switchIntoOrg(org.clerkId, org.name);
          }}
          disabled={switchingOrgId !== null}
          title={`Switch into ${org.name}`}
          className="v-t-micro v-press flex shrink-0 items-center gap-1.5 rounded-v border border-v-line px-2.5 py-1.5 text-v-mut transition-colors hover:border-v-faint hover:text-v-ink disabled:opacity-40"
        >
          {isSwitching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ArrowRightLeft className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Switch</span>
        </button>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="shrink-0 text-v-faint"
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
            <div className="space-y-4 border-t border-v-line bg-v-bg px-4 pb-4 pt-3">

              {/* Members grid */}
              {org.members && org.members.length > 0 ? (
                <div>
                  <p className="v-t-micro mb-2 text-v-faint">Staff</p>
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
                <p className="text-xs text-v-faint">No members in this workspace.</p>
              )}

              {/* Features */}
              <div>
                <p className="v-t-micro mb-2 text-v-faint">Features</p>
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-v border border-v-line bg-v-line sm:grid-cols-2 lg:grid-cols-3">
                  {FEATURES.map((feat) => (
                    <div
                      key={feat.key}
                      className="flex items-center justify-between bg-v-bg-raise px-3 py-2.5"
                    >
                      <span className="text-xs text-v-mut">{feat.label}</span>
                      <Toggle
                        enabled={features[feat.key]}
                        onChange={() => toggleFeature(feat.key)}
                        disabled={savingFeature === feat.key}
                      />
                    </div>
                  ))}
                  {/* Filler keeps the hairline grid flush (5 items / 2-3 cols) */}
                  <div className="hidden bg-v-bg-raise sm:block" aria-hidden />
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
