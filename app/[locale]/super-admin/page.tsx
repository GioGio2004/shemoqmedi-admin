import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { inviteAdminAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OrgSwitcherWidget } from "@/components/OrgSwitcherWidget";
import {
  Building2, Shield, Activity, Mail, Users,
  Zap, SendHorizonal, Lock, ArrowUpRight,
} from "lucide-react";

export default async function SuperAdminPage() {
  const { sessionClaims } = await auth();
  const metadata = sessionClaims?.metadata as { role?: string };
  if (metadata?.role !== "super_admin") redirect("/");

  const client = await clerkClient();
  const { data: organizations } = await client.organizations.getOrganizationList({ limit: 100 });

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">Shemoqmedi</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Super Admin Console</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 text-[11px] text-muted-foreground border-border">
              <Lock className="h-3 w-3" />
              Private
            </Badge>
            <Badge variant="outline" className="gap-1.5 border-primary/30 bg-primary/8 text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Online
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 space-y-10">
        {/* ── Hero ── */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">Command Center</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Workspace Management</h1>
          <p className="mt-1.5 text-muted-foreground text-sm">
            Onboard cafe managers and monitor active workspaces. Switch context with the org switcher below.
          </p>
        </div>

        {/* ── Org Switcher + Stat row ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Org Switcher card */}
          <Card className="sm:col-span-2 lg:col-span-1 bg-card border-border">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Active Context
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <OrgSwitcherWidget />
            </CardContent>
          </Card>

          {/* Total workspaces */}
          <Card className="relative overflow-hidden bg-card border-border">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs text-muted-foreground">Total Workspaces</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold tabular-nums text-foreground">{organizations.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Active organizations</p>
            </CardContent>
            <div className="absolute -right-4 -bottom-4 h-20 w-20 rounded-full bg-primary/8 blur-xl" />
          </Card>

          {/* System status */}
          <Card className="relative overflow-hidden bg-card border-border">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                System Status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_oklch(0.62_0.17_145)]" />
                <p className="text-lg font-bold text-foreground">Healthy</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">All services operational</p>
            </CardContent>
            <div className="absolute -right-4 -bottom-4 h-20 w-20 rounded-full bg-emerald-500/8 blur-xl" />
          </Card>

          {/* Access level */}
          <Card className="relative overflow-hidden bg-card border-border">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Shield className="h-3.5 w-3.5" />
                Access Level
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold text-primary">Super Admin</p>
              <p className="text-xs text-muted-foreground mt-1">Full platform access</p>
            </CardContent>
            <div className="absolute -right-4 -bottom-4 h-20 w-20 rounded-full bg-primary/8 blur-xl" />
          </Card>
        </div>

        <Separator className="bg-border" />

        {/* ── Main grid ── */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Invite form */}
          <Card className="lg:col-span-2 flex flex-col bg-card border-border">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
                  <SendHorizonal className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base text-foreground">Invite Cafe Manager</CardTitle>
                  <CardDescription className="text-muted-foreground">Send an org:admin invitation</CardDescription>
                </div>
              </div>
            </CardHeader>
            <Separator className="mx-6 w-auto bg-border" />
            <CardContent className="pt-6 flex-1">
              {organizations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">No workspaces yet</p>
                  <p className="text-xs text-muted-foreground">
                    Create organizations in the{" "}
                    <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer"
                      className="text-primary hover:underline underline-offset-2">
                      Clerk Dashboard
                    </a>{" "}first.
                  </p>
                </div>
              ) : (
                <form action={inviteAdminAction} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="organizationId"
                      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Workspace
                    </Label>
                    <select id="organizationId" name="organizationId" required
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-all">
                      <option value="">Select a workspace…</option>
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>{org.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="emailAddress"
                      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Manager Email
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input id="emailAddress" name="emailAddress" type="email"
                        placeholder="manager@cafe.com" required
                        className="pl-9 rounded-xl border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-ring/40" />
                    </div>
                  </div>

                  {/* Role info */}
                  <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-foreground">Assigned Role</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Full workspace access</p>
                    </div>
                    <Badge variant="outline" className="border-primary/30 bg-primary/8 text-primary font-mono text-xs">
                      org:admin
                    </Badge>
                  </div>

                  <Button type="submit" size="lg"
                    className="w-full gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-[0_0_24px_oklch(0.718_0.195_53.4_/_0.18)] transition-all">
                    <SendHorizonal className="h-4 w-4" />
                    Send Invitation
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Orgs table */}
          <Card className="lg:col-span-3 flex flex-col bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base text-foreground">Active Workspaces</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {organizations.length} organization{organizations.length !== 1 ? "s" : ""} registered
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground border-border">
                  {organizations.length} total
                </Badge>
              </div>
            </CardHeader>
            <Separator className="mx-6 w-auto bg-border" />
            <CardContent className="pt-4 flex-1">
              {organizations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                  <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">No workspaces yet</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Create organizations in Clerk to get started.</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border bg-muted/30">
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Organization</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Slug</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Members</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {organizations.map((org) => (
                        <TableRow key={org.id} className="border-border hover:bg-muted/30 transition-colors">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary font-bold text-sm ring-1 ring-primary/20">
                                {org.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold text-foreground leading-none">{org.name}</p>
                                <p className="mt-1 text-xs text-muted-foreground sm:hidden">{org.slug || "—"}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {org.slug
                              ? <Badge variant="outline" className="font-mono text-xs border-border text-muted-foreground">/{org.slug}</Badge>
                              : <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm font-semibold text-foreground tabular-nums">
                                {org.membersCount ?? "—"}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            {organizations.length > 0 && (
              <CardFooter className="border-t border-border pt-4">
                <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                  Manage in Clerk Dashboard
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </CardFooter>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}