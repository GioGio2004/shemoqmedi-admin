import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { GuideDetail } from "@/components/admin/GuideDetail";

export const metadata: Metadata = { title: "Guide | Shemoqmedi Admin" };

export default async function GuidePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ slug }, { edit }] = await Promise.all([params, searchParams]);
  return (
    <AdminShell>
      <GuideDetail key={slug} slug={slug} startEditing={edit === "1"} />
    </AdminShell>
  );
}
