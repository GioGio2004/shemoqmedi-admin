import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardOverviewClient } from "./_components/dashboard-overview-client";

export default async function DashboardOverviewPage() {
  const { userId, orgId } = await auth();

  // Guard: must be authenticated to access dashboard
  if (!userId) redirect("/sign-in");

  if (!orgId) {
    return (
      <div className="space-y-6 text-zinc-50 font-sans">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
          <h1 className="text-3xl font-medium tracking-tight text-white">
            Overview
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Select a workspace using the switcher in the sidebar to get started.
          </p>
        </div>
      </div>
    );
  }

  return <DashboardOverviewClient orgId={orgId} />;
}