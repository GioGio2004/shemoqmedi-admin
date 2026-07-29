import { redirect } from "next/navigation";

// AI chat customization merged into the Storefront studio (Chat section).
// Kept as a redirect so old links and muscle memory keep working.
export default async function ChatThemePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/storefront`);
}
