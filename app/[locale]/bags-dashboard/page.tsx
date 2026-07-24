import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { BagsOverviewClient } from "./_components/bags-overview-client";

export default async function BagsDashboardPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  if (!orgId) {
    return (
      <div className="pt-16 text-center">
        <p className="v-t-micro mb-2 text-v-faint">Surprise Bags</p>
        <h1 className="font-v-display text-xl font-medium text-v-ink">
          No workspace selected
        </h1>
        <p className="mt-2 text-sm text-v-mut">
          Select a workspace to manage your Surprise Bags.
        </p>
      </div>
    );
  }

  return <BagsOverviewClient orgId={orgId} />;
}
