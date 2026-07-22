import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { BagsOverviewClient } from "./_components/bags-overview-client";

export default async function BagsDashboardPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  if (!orgId) {
    return (
      <div className="pt-16 text-center">
        <h1 className="text-xl font-medium text-white">No workspace selected</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Select a workspace to manage your Surprise Bags.
        </p>
      </div>
    );
  }

  return <BagsOverviewClient orgId={orgId} />;
}
