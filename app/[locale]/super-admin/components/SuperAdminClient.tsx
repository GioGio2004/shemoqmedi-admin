"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrgSwitcherWidget } from "@/components/OrgSwitcherWidget";
import { RosterRow } from "./RosterRow";
import { ClerkOrgPanel } from "./ClerkOrgPanel";
import { NTagFleetPanel } from "./NTagFleetPanel";
import { Toaster } from "sonner";
import {
  Building2,
  Activity,
  Users,
  Zap,
  Lock,
  ArrowUpRight,
  AlertCircle,
  Shield,
  Nfc,
} from "lucide-react";

type Tab = "workspaces" | "ntags";

interface SuperAdminClientProps {
  organizations: any[];
  totalMembers: number;
  allOrgsEmpty: boolean;
}

export function SuperAdminClient({
  organizations,
  totalMembers,
  allOrgsEmpty,
}: SuperAdminClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>("workspaces");

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: "workspaces",
      label: "Workspaces",
      icon: <Building2 className="h-3.5 w-3.5" />,
    },
    {
      id: "ntags",
      label: "NFC Fleet",
      icon: <Nfc className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="min-h-screen bg-black relative overflow-hidden text-zinc-50 font-sans">
      <Toaster position="bottom-right" theme="dark" richColors />

      {/* ── Top bar ── */}
      <header className="animate-in fade-in slide-in-from-top-4 duration-700 sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 border border-white/20">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-white leading-none tracking-tight">
                Shemoqmedi
              </p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Super Admin Console
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 text-[11px] text-zinc-400 border-white/10"
            >
              <Lock className="h-3 w-3" />
              Private
            </Badge>
            <Badge
              variant="outline"
              className="gap-1.5 border-white/20 bg-white/5 text-white font-medium"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Online
            </Badge>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="mx-auto max-w-7xl px-6 flex gap-1 border-t border-white/5">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
                  active
                    ? "text-white border-white"
                    : "text-zinc-500 border-transparent hover:text-zinc-300"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.id === "ntags" && (
                  <span className="text-[9px] font-bold bg-white/10 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                    Super Admin
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-10 space-y-12">

        {/* ══════════════════════════════════════════
            TAB: WORKSPACES
        ══════════════════════════════════════════ */}
        {activeTab === "workspaces" && (
          <>
            {/* ── Hero ── */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-white" />
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Command Center
                </span>
              </div>
              <h1 className="text-4xl font-medium tracking-tight text-white">
                Workspace Management
              </h1>
              <p className="mt-2 text-zinc-400 text-sm max-w-2xl leading-relaxed">
                Manage organizations and staff securely. Assign hospitality
                roles and configure tenant settings in real-time.
              </p>
            </div>

            {organizations.length > 0 && allOrgsEmpty && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-mode-both flex items-start gap-3 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Members not syncing yet</p>
                  <p className="text-zinc-400 text-xs mt-0.5">
                    Make sure{" "}
                    <code className="bg-white/10 px-1 py-0.5 rounded text-white">
                      organizationMembership.created
                    </code>{" "}
                    is enabled in your Clerk webhooks.
                  </p>
                </div>
              </div>
            )}

            {/* ── Stat row ── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both sm:col-span-2 lg:col-span-1 bg-[#09090b] border-white/10 shadow-none hover:border-white/20 transition-all">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                    <Building2 className="h-3.5 w-3.5" />
                    Active Context
                  </CardDescription>
                </CardHeader>
                <CardContent className="pb-4">
                  <OrgSwitcherWidget />
                </CardContent>
              </Card>

              <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500 fill-mode-both bg-[#09090b] border-white/10 shadow-none hover:border-white/20 transition-all">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs text-zinc-400 font-medium">
                    Total Workspaces
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-4xl font-medium tabular-nums text-white">
                    {organizations.length}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 font-medium">
                    Active organizations
                  </p>
                </CardContent>
              </Card>

              <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500 fill-mode-both bg-[#09090b] border-white/10 shadow-none hover:border-white/20 transition-all">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                    <Users className="h-3.5 w-3.5" />
                    Staff in Convex
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-4xl font-medium tabular-nums text-white">
                    {totalMembers}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 font-medium">
                    Synced via webhooks
                  </p>
                </CardContent>
              </Card>

              <Card className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500 fill-mode-both bg-[#09090b] border-white/10 shadow-none hover:border-white/20 transition-all">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                    <Activity className="h-3.5 w-3.5" />
                    System Status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="relative flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-40" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
                    </span>
                    <p className="text-lg font-medium text-white leading-none">
                      Operational
                    </p>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2 font-medium">
                    All services healthy
                  </p>
                </CardContent>
              </Card>
            </div>

            <Separator className="bg-white/10" />

            {/* ── Clerk Org Panel ── */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-1000 fill-mode-both">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-white" />
                <h2 className="text-lg font-medium text-white">
                  Organization Management
                </h2>
                <Badge
                  variant="outline"
                  className="ml-2 text-[10px] text-zinc-400 border-white/10 bg-white/5 gap-1 font-medium"
                >
                  <Shield className="h-2.5 w-2.5" />
                  Clerk Provider
                </Badge>
              </div>
              <p className="text-sm text-zinc-400 mb-6 max-w-2xl">
                Invite staff to an organization securely. Once they accept,
                their record syncs to Convex and populates the roster.
              </p>
              <div className="rounded-2xl border border-white/10 bg-[#09090b] shadow-2xl overflow-hidden p-1">
                <ClerkOrgPanel />
              </div>
            </div>

            <Separator className="bg-white/10" />

            {/* ── Roster ── */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-1000 fill-mode-both">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="h-4 w-4 text-white" />
                <h2 className="text-lg font-medium text-white">
                  Active Workspaces
                </h2>
                <Badge
                  variant="secondary"
                  className="ml-2 text-[10px] bg-white/10 text-white border-white/20 font-medium"
                >
                  {organizations.length} orgs · {totalMembers} staff
                </Badge>
              </div>
              <p className="text-sm text-zinc-400 mb-6 max-w-2xl">
                Click any organization row to expand its roster. Use the
                dropdown to assign hospitality roles.
              </p>
              <Card className="flex flex-col bg-[#09090b] border-white/10 shadow-none overflow-hidden">
                <CardContent className="p-0">
                  {organizations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
                      <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                        <Building2 className="h-7 w-7 text-zinc-500" />
                      </div>
                      <div>
                        <p className="font-medium text-white text-lg">
                          No workspaces synced yet
                        </p>
                        <p className="text-sm text-zinc-400 mt-1 max-w-sm mx-auto">
                          Create an organization in Clerk to auto-populate this
                          section via webhooks.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent border-white/10 bg-white/5">
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 px-6 h-10">
                            Organization
                          </TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hidden sm:table-cell h-10">
                            Slug
                          </TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 text-right px-6 h-10">
                            Members
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {organizations.map((org: any) => (
                          <RosterRow key={org._id} org={org} />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
                <CardFooter className="border-t border-white/10 bg-white/[0.02] py-3 px-6 flex items-center justify-between">
                  <p className="text-xs text-zinc-500 font-medium">
                    Membership data auto-synced via secure webhooks.
                  </p>
                  <a
                    href="https://dashboard.clerk.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
                  >
                    Clerk Dashboard
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </CardFooter>
              </Card>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════
            TAB: NFC FLEET
        ══════════════════════════════════════════ */}
        {activeTab === "ntags" && (
          <>
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
              <div className="flex items-center gap-2 mb-2">
                <Nfc className="h-4 w-4 text-white" />
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Hardware Management
                </span>
              </div>
              <h1 className="text-4xl font-medium tracking-tight text-white">
                NFC Fleet
              </h1>
              <p className="mt-2 text-zinc-400 text-sm max-w-2xl leading-relaxed">
                Provision, assign, and manage NTAG216 chips across all cafe
                locations. Each chip maps to a physical table and redirects
                customers to the correct digital menu when tapped.
              </p>
            </div>

            <NTagFleetPanel organizations={organizations} />
          </>
        )}
      </main>
    </div>
  );
}
