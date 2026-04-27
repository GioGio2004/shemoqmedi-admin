import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createOrganizationAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import {
    Building2,
    Plus,
    Shield,
    Activity,
    Globe,
    Copy,
    Rocket,
    Users,
    LayoutGrid,
    Zap,
} from "lucide-react";

export default async function SuperAdminPage() {
    const { sessionClaims } = await auth();

    // Tell TypeScript what our custom metadata looks like
    const metadata = sessionClaims?.metadata as { role?: string };

    // 1. Bouncer: Kick out anyone who isn't a super_admin
    if (metadata?.role !== "super_admin") {
        redirect("/");
    }

    // 2. Fetch all organizations
    const client = await clerkClient();
    const orgsResponse = await client.organizations.getOrganizationList({
        limit: 50,
    });
    const organizations = orgsResponse.data;

    return (
        <div className="min-h-screen bg-background">
            {/* ─── Top Bar ─── */}
            <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                            <Shield className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-sm font-semibold tracking-tight">
                                Shemoqmedi
                            </h1>
                            <p className="text-[11px] text-muted-foreground">
                                Super Admin Console
                            </p>
                        </div>
                    </div>
                    <Badge
                        variant="outline"
                        className="gap-1.5 border-primary/30 bg-primary/5 text-primary"
                    >
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                        </span>
                        System Online
                    </Badge>
                </div>
            </header>

            {/* ─── Main Content ─── */}
            <main className="mx-auto max-w-7xl px-6 py-10">
                {/* Hero Section */}
                <div className="mb-10">
                    <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-5 w-5 text-primary" />
                        <span className="text-xs font-medium uppercase tracking-widest text-primary">
                            Command Center
                        </span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight">
                        Infrastructure Overview
                    </h2>
                    <p className="mt-1.5 text-muted-foreground">
                        Manage multi-tenant workspaces and monitor system
                        health.
                    </p>
                </div>

                {/* ─── Stat Cards ─── */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-10">
                    <Card className="relative overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardDescription className="flex items-center gap-1.5 text-xs">
                                <Building2 className="h-3.5 w-3.5" />
                                Total Workspaces
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold tabular-nums">
                                {organizations.length}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Active organizations
                            </p>
                        </CardContent>
                        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-primary/5" />
                    </Card>

                    <Card className="relative overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardDescription className="flex items-center gap-1.5 text-xs">
                                <Users className="h-3.5 w-3.5" />
                                Team Members
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold tabular-nums">
                                —
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Across all workspaces
                            </p>
                        </CardContent>
                        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-chart-1/10" />
                    </Card>

                    <Card className="relative overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardDescription className="flex items-center gap-1.5 text-xs">
                                <Activity className="h-3.5 w-3.5" />
                                System Status
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-2">
                                <div className="text-3xl font-bold text-emerald-500">
                                    ●
                                </div>
                                <span className="text-lg font-semibold">
                                    Healthy
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                All services operational
                            </p>
                        </CardContent>
                        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-emerald-500/5" />
                    </Card>

                    <Card className="relative overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardDescription className="flex items-center gap-1.5 text-xs">
                                <Globe className="h-3.5 w-3.5" />
                                Platform
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="text-lg font-semibold">
                                Clerk + Convex
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Multi-tenant SaaS stack
                            </p>
                        </CardContent>
                        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-chart-2/10" />
                    </Card>
                </div>

                {/* ─── Main Grid ─── */}
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* ─── Deploy New Workspace ─── */}
                    <Card className="lg:col-span-1 flex flex-col">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                                    <Rocket className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                    <CardTitle>Deploy Workspace</CardTitle>
                                    <CardDescription>
                                        Initialize a new organization
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <Separator className="mx-6 w-auto" />
                        <CardContent className="pt-6 flex-1">
                            <form
                                action={createOrganizationAction}
                                className="space-y-5"
                            >
                                <div className="space-y-2">
                                    <Label
                                        htmlFor="name"
                                        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                                    >
                                        Organization Name
                                    </Label>
                                    <Input
                                        id="name"
                                        name="name"
                                        placeholder="e.g., Stamba Cafe"
                                        required
                                        className="bg-muted/50 border-border/50 focus-visible:border-primary/50 transition-colors"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label
                                        htmlFor="slug"
                                        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                                    >
                                        URL Slug{" "}
                                        <span className="normal-case tracking-normal text-muted-foreground/60">
                                            (optional)
                                        </span>
                                    </Label>
                                    <Input
                                        id="slug"
                                        name="slug"
                                        placeholder="e.g., stamba"
                                        className="bg-muted/50 border-border/50 focus-visible:border-primary/50 transition-colors"
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    className="w-full gap-2"
                                    size="lg"
                                >
                                    <Plus className="h-4 w-4" />
                                    Initialize Workspace
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    {/* ─── Active Deployments Table ─── */}
                    <Card className="lg:col-span-2 flex flex-col">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-chart-1/10">
                                        <LayoutGrid className="h-4 w-4 text-chart-1" />
                                    </div>
                                    <div>
                                        <CardTitle>
                                            Active Deployments
                                        </CardTitle>
                                        <CardDescription>
                                            {organizations.length} workspace
                                            {organizations.length !== 1
                                                ? "s"
                                                : ""}{" "}
                                            deployed
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="secondary" className="text-xs">
                                    {organizations.length} total
                                </Badge>
                            </div>
                        </CardHeader>
                        <Separator className="mx-6 w-auto" />
                        <CardContent className="pt-6 flex-1">
                            {organizations.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted/60">
                                        <Building2 className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                    <h3 className="font-medium text-foreground">
                                        No workspaces yet
                                    </h3>
                                    <p className="mt-1 text-sm text-muted-foreground max-w-[240px]">
                                        Deploy your first organization to get
                                        started.
                                    </p>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-border/50 overflow-hidden">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="hover:bg-transparent border-border/50">
                                                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                                    Organization
                                                </TableHead>
                                                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                                                    Slug
                                                </TableHead>
                                                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                                                    ID
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {organizations.map((org) => (
                                                <TableRow
                                                    key={org.id}
                                                    className="border-border/30 hover:bg-muted/30 transition-colors"
                                                >
                                                    <TableCell>
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary font-semibold text-sm">
                                                                {org.name
                                                                    .charAt(0)
                                                                    .toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <p className="font-medium leading-none">
                                                                    {org.name}
                                                                </p>
                                                                <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                                                                    {org.slug ||
                                                                        "no slug"}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="hidden sm:table-cell">
                                                        {org.slug ? (
                                                            <Badge
                                                                variant="outline"
                                                                className="font-mono text-xs"
                                                            >
                                                                /{org.slug}
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground/50">
                                                                —
                                                            </span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <span
                                                            className="inline-flex items-center gap-1.5 cursor-default"
                                                            title={org.id}
                                                        >
                                                            <code className="rounded bg-muted/60 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                                                                {org.id.slice(0, 12)}…
                                                            </code>
                                                            <Copy className="h-3 w-3 text-muted-foreground/40" />
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                        {organizations.length > 0 && (
                            <CardFooter className="justify-center border-t border-border/30 pt-4">
                                <p className="text-xs text-muted-foreground">
                                    Showing {organizations.length} of{" "}
                                    {organizations.length} workspaces
                                </p>
                            </CardFooter>
                        )}
                    </Card>
                </div>
            </main>
        </div>
    );
}