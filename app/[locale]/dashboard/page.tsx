import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { DashboardOverviewClient } from "./_components/dashboard-overview-client";

export default async function DashboardOverviewPage() {
  const { userId, orgId, getToken } = await auth();

  // Guard: must be authenticated to access dashboard
  if (!userId) redirect("/sign-in");

  // ── Surprise Bags gating ──────────────────────────────────────────────────
  // Orgs onboarded as "bags" only get the Surprise Bags dashboard.
  if (orgId) {
    try {
      const token = (await getToken({ template: "convex" })) ?? undefined;
      const gating = await fetchQuery(
        api.bagsDashboard.getOrgGating,
        { orgId },
        token ? { token } : undefined,
      );
      if (gating.onboardingType === "bags") redirect("/bags-dashboard");
    } catch (e) {
      // redirect() throws internally — re-throw it; swallow only Convex errors
      if (e && typeof e === "object" && "digest" in e) throw e;
    }
  }

  if (!orgId) {
    return (
      <div className="space-y-6 text-zinc-50 font-sans">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
          <h1 className="text-3xl font-medium tracking-tight text-white">
            Overview
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            No active workspace on this session. Reopen the dashboard from your
            invitation link, or sign out and back in to activate your
            workspace.
          </p>
        </div>
      </div>
    );
  }

  return <DashboardOverviewClient orgId={orgId} />;
}