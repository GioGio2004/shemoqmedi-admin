import type { Metadata } from "next";
import { Reels } from "@/components/studio/reels/Reels";

export const metadata: Metadata = { title: "Reels" };

export default function ReelsPage() {
  return <Reels />;
}
