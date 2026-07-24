import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { BagsOrdersClient } from "../_components/bags-orders-client";

export default async function BagsOrdersPage() {
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
          Select a workspace to see incoming bag orders.
        </p>
      </div>
    );
  }

  return <BagsOrdersClient orgId={orgId} />;
}
