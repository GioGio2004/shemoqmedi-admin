"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RosterRow } from "./RosterRow";
import { ClerkOrgPanel } from "./ClerkOrgPanel";
import { NTagFleetPanel } from "./NTagFleetPanel";
import { Toaster } from "sonner";
import { useState } from "react";
import { Shield, Building2, Nfc, Loader2 } from "lucide-react";

type Tab = "workspaces" | "ntags";

export function SuperAdminClient() {
  const [activeTab, setActiveTab] = useState<Tab>("workspaces");

  // ── Real-time — reacts instantly to any Convex mutation ──
  const organizations = useQuery(api.organizations.getAllOrganizationsWithMembers);

  const isLoading = organizations === undefined;
  const orgs = organizations ?? [];
  const totalMembers = orgs.reduce((sum, org: any) => sum + (org.members?.length ?? 0), 0);

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "workspaces", label: "Workspaces", icon: Building2 },
    { id: "ntags", label: "NFC Fleet", icon: Nfc },
  ];

  return (
    <div className="min-h-screen bg-black text-zinc-50 font-sans">
      <Toaster position="bottom-right" theme="dark" richColors />

      {/* ── Top bar ── */}
      <header className="sticky top-0 z-50 border-b border-white/8 bg-black/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 border border-white/12">
              <Shield className="h-3.5 w-3.5 text-zinc-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white leading-none">Super Admin</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Shemoqmedi Platform</p>
            </div>
          </div>

          {/* Stats pill */}
          <div className="hidden sm:flex items-center gap-4 text-xs text-zinc-500">
            <span>
              <span className="text-white font-medium tabular-nums">{orgs.length}</span>
              {" "}workspaces
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              <span className="text-white font-medium tabular-nums">{totalMembers}</span>
              {" "}members
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-5xl px-6 flex gap-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-all border-b-2 -mb-px ${
                  active
                    ? "text-white border-white"
                    : "text-zinc-500 border-transparent hover:text-zinc-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">

        {/* ── TAB: WORKSPACES ── */}
        {activeTab === "workspaces" && (
          <>
            {/* ── Org roster ── */}
            <section className="space-y-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-sm font-medium text-white">Active Workspaces</h1>
                  <p className="text-xs text-zinc-500 mt-0.5">Click a row to expand roster and feature controls</p>
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                </div>
              ) : orgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/8 rounded-xl">
                  <Building2 className="h-8 w-8 text-zinc-700 mb-3" />
                  <p className="text-sm text-zinc-400 font-medium">No workspaces yet</p>
                  <p className="text-xs text-zinc-600 mt-1">Create an organization in Clerk to get started.</p>
                </div>
              ) : (
                <div className="border border-white/8 rounded-xl overflow-hidden divide-y divide-white/8">
                  {orgs.map((org: any) => (
                    <RosterRow key={org._id} org={org} />
                  ))}
                </div>
              )}
            </section>

            {/* ── Invite via Clerk ── */}
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-medium text-white">Organization Management</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Invite staff and manage membership via Clerk</p>
              </div>
              <div className="border border-white/8 rounded-xl overflow-hidden">
                <ClerkOrgPanel />
              </div>
            </section>
          </>
        )}

        {/* ── TAB: NFC FLEET ── */}
        {activeTab === "ntags" && (
          <section className="space-y-3">
            <div>
              <h1 className="text-sm font-medium text-white">NFC Fleet</h1>
              <p className="text-xs text-zinc-500 mt-0.5">Provision and manage NTAG216 chips across all locations</p>
            </div>
            <NTagFleetPanel organizations={orgs} />
          </section>
        )}
      </main>
    </div>
  );
}
