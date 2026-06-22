import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SuperAdminClient } from "./components/SuperAdminClient";

export default async function SuperAdminPage() {
  const { sessionClaims } = await auth();
  const metadata = sessionClaims?.metadata as { role?: string };
  if (metadata?.role !== "super_admin") redirect("/");

  return <SuperAdminClient />;
}
