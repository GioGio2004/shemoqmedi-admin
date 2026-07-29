import { redirect } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// RETIRED — menu templates now live inside the storefront workspace.
//
// This page and the workspace both edited themeSettings from their own local
// copy, so whichever saved last won. That is how a venue ended up with a
// published custom design while menuType still pointed at a fixed template:
// the consumer routes on menuType, so the design never rendered.
//
// The workspace is now the single editor — a picker modal writes menuType (and
// only menuType), and the Template section holds that template's own options.
// ─────────────────────────────────────────────────────────────────────────────

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/storefront`);
}
