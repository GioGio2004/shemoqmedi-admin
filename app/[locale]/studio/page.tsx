import { redirect } from "next/navigation";

// Shemoqmedi Studio merged into the dashboard — the Storefront route is now
// the one design workspace. Kept as a redirect so old links keep working.
export default async function StudioPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/storefront`);
}
