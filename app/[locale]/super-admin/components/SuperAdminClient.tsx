"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RosterRow } from "./RosterRow";
import { ClerkOrgPanel } from "./ClerkOrgPanel";
import { CreateOrgDialog } from "./CreateOrgDialog";
import { NTagFleetPanel } from "./NTagFleetPanel";
import { BulkImportPanel } from "./BulkImportPanel";
import { AiTrainingPanel } from "./AiTrainingPanel";
import { EnlistingPanel } from "./EnlistingPanel";
import { Toaster } from "sonner";
import { useState } from "react";
import { Shield, Building2, Loader2, Wand2 } from "lucide-react";
import Link from "next/link";

type Tab = "workspaces" | "ntags" | "import" | "ai_training" | "enlisting";

const TABS: { id: Tab; index: string; label: string }[] = [
  { id: "workspaces", index: "01", label: "Roster" },
  { id: "ntags", index: "02", label: "NFC Fleet" },
  { id: "import", index: "03", label: "Import" },
  { id: "ai_training", index: "04", label: "AI Training" },
  { id: "enlisting", index: "05", label: "Enlisting" },
];

/** RULED section header — mono index label + display title. */
function SectionHeader({
  index,
  label,
  title,
  desc,
}: {
  index: string;
  label: string;
  title: string;
  desc?: string;
}) {
  return (
    <div>
      <p className="v-t-micro text-v-faint">
        {index} — {label}
      </p>
      <h1 className="mt-1.5 font-v-display text-lg tracking-tight text-v-ink">
        {title}
      </h1>
      {desc && <p className="mt-0.5 text-xs text-v-mut">{desc}</p>}
    </div>
  );
}

export function SuperAdminClient() {
  const [activeTab, setActiveTab] = useState<Tab>("workspaces");

  // ── Real-time — reacts instantly to any Convex mutation ──
  const { isAuthenticated } = useConvexAuth();
  const organizations = useQuery(
    api.organizations.getAllOrganizationsWithMembers,
    isAuthenticated ? {} : "skip",
  );

  const isLoading = organizations === undefined;
  const orgs = organizations ?? [];
  const totalMembers = orgs.reduce((sum, org: any) => sum + (org.members?.length ?? 0), 0);

  return (
    <div className="min-h-screen bg-v-bg text-v-ink">
      <Toaster position="bottom-right" theme="dark" />

      {/* ── Top bar — flat surface, hairline below ── */}
      <header className="sticky top-0 z-50 border-b border-v-line bg-v-bg">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
              <Shield className="h-3.5 w-3.5 text-v-mut" />
            </div>
            <div>
              <p className="v-t-micro leading-none text-v-ink">Super Admin</p>
              <p className="v-t-micro mt-0.5 text-v-faint">Shemoqmedi Platform</p>
            </div>
          </div>

          {/* Stats — mono numbers */}
          <div className="flex items-center gap-4">
            <span className="v-t-micro hidden text-v-faint sm:inline">
              <span className="font-v-mono tabular-nums text-v-ink">{orgs.length}</span>{" "}
              Workspaces
            </span>
            <span className="v-hairline-v hidden h-3 sm:block" aria-hidden />
            <span className="v-t-micro hidden text-v-faint sm:inline">
              <span className="font-v-mono tabular-nums text-v-ink">{totalMembers}</span>{" "}
              Members
            </span>
            <Link
              href="/dashboard/storefront"
              className="v-t-micro v-press flex items-center gap-1.5 rounded-v border border-v-line px-2.5 py-1.5 text-v-mut transition-colors hover:border-white/25 hover:text-v-ink"
            >
              <Wand2 className="h-3 w-3 text-v-accent" />
              Studio
            </Link>
          </div>
        </div>

        {/* Tabs — mono micro-labels, accent underline on active, scrolls at 375px */}
        <nav
          aria-label="Sections"
          className="mx-auto flex max-w-5xl overflow-x-auto px-4 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`v-t-micro v-press shrink-0 whitespace-nowrap border-b-2 px-4 py-3 transition-colors ${
                  active
                    ? "border-v-accent text-v-ink"
                    : "border-transparent text-v-faint hover:text-v-mut"
                }`}
              >
                <span className={active ? "text-v-accent" : "text-v-faint"}>
                  {tab.index}
                </span>
                <span className="ml-1.5">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6">
        {/* ── 01 — ROSTER ── */}
        {activeTab === "workspaces" && (
          <>
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <SectionHeader
                  index="01"
                  label="Roster"
                  title="Active workspaces"
                  desc="Tap a row to expand roster and feature controls"
                />
                <CreateOrgDialog />
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-v-faint" />
                </div>
              ) : orgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-v border border-dashed border-v-line py-20 text-center">
                  <Building2 className="mb-3 h-8 w-8 text-v-faint" />
                  <p className="text-sm text-v-ink">No workspaces yet</p>
                  <p className="mt-1 text-xs text-v-mut">
                    Create an organization in Clerk to get started.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-v-line overflow-hidden rounded-v border border-v-line bg-v-bg-raise">
                  {orgs.map((org: any) => (
                    <RosterRow key={org._id} org={org} />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <SectionHeader
                index="01.1"
                label="Org Management"
                title="Invitations & membership"
                desc="Invite staff and manage membership via Clerk"
              />
              <div className="overflow-hidden rounded-v border border-v-line">
                <ClerkOrgPanel />
              </div>
            </section>
          </>
        )}

        {/* ── 02 — NFC FLEET ── */}
        {activeTab === "ntags" && (
          <section className="space-y-4">
            <SectionHeader
              index="02"
              label="NFC Fleet"
              title="Physical tag fleet"
              desc="Provision and manage NTAG216 chips across all locations"
            />
            <NTagFleetPanel organizations={orgs} />
          </section>
        )}

        {/* ── 03 — IMPORT ── */}
        {activeTab === "import" && (
          <section className="space-y-4">
            <SectionHeader
              index="03"
              label="Import"
              title="Bulk menu import"
              desc="Paste a structured JSON payload to seed an entire menu in one operation"
            />
            <div className="rounded-v border border-v-line bg-v-bg-raise p-4 sm:p-6">
              <BulkImportPanel organizations={orgs} />
            </div>
          </section>
        )}

        {/* ── 04 — AI TRAINING ── */}
        {activeTab === "ai_training" && (
          <section className="space-y-4">
            <SectionHeader
              index="04"
              label="AI Training"
              title="Global training logs"
              desc="Monitor Nootype telemetry and export SFT-ready JSONL datasets"
            />
            <AiTrainingPanel />
          </section>
        )}

        {/* ── 05 — ENLISTING ── */}
        {activeTab === "enlisting" && (
          <section className="space-y-4">
            <SectionHeader
              index="05"
              label="Enlisting"
              title="Venue directory"
              desc="Seed, claim and manage the public venue directory"
            />
            <EnlistingPanel organizations={orgs} />
          </section>
        )}
      </main>
    </div>
  );
}
