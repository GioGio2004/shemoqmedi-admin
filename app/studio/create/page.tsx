import type { Metadata } from "next";
import { Create } from "@/components/studio/create/Create";

export const metadata: Metadata = { title: "Create" };

// ?output=story starts a story (the Home quick action).
export default async function CreatePage({ searchParams }: { searchParams: Promise<{ output?: string | string[] }> }) {
  const { output } = await searchParams;
  const first = Array.isArray(output) ? output[0] : output;
  const initial = first === "story" || first === "carousel" ? first : "single";
  return <Create key={initial} initialOutput={initial} />;
}
