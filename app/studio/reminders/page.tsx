import type { Metadata } from "next";
import { Reminders } from "@/components/studio/reminders/Reminders";

export const metadata: Metadata = { title: "Reminders" };

// ?new=1 opens the new-reminder field (the Home quick action).
export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ new?: string | string[] }> }) {
  const params = await searchParams;
  return <Reminders autoFocus={params.new !== undefined} />;
}
