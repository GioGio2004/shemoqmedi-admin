import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { TaskAdmin } from "@/components/tasks/TaskAdmin";

export const metadata: Metadata = { title: "Tasks | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell and in convex/tasks.ts.
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  const { guide } = await searchParams;
  return (
    <AdminShell>
      <TaskAdmin key={guide ?? ""} presetGuide={guide} />
    </AdminShell>
  );
}
