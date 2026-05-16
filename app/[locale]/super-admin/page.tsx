import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SuperAdminClient } from "./components/SuperAdminClient";

export default async function SuperAdminPage() {
  const { sessionClaims } = await auth();
  const metadata = sessionClaims?.metadata as { role?: string };
  if (metadata?.role !== "super_admin") redirect("/");

  const organizations = await fetchQuery(
    api.organizations.getAllOrganizationsWithMembers
  );

  const totalMembers = organizations.reduce(
    (sum: number, org: any) => sum + (org.members?.length ?? 0),
    0
  );
  const allOrgsEmpty = organizations.every(
    (org: any) => (org.members?.length ?? 0) === 0
  );

  return (
    <SuperAdminClient 
      organizations={organizations}
      totalMembers={totalMembers}
      allOrgsEmpty={allOrgsEmpty}
    />
  );
}