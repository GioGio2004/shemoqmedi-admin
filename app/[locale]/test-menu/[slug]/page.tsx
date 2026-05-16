import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Metadata } from "next";
import Image from "next/image";
import { MenuImage } from "@/components/MenuImage";
import { UtensilsCrossed } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ slug: string; locale: string }>;
};

type MenuData = NonNullable<Awaited<ReturnType<typeof fetchQuery<typeof api.publicMenu.get>>>>;
type Category = MenuData["categories"][number];
type MenuItem = Category["items"][number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the best available string for a given locale from a multilingual record. */
function t(record: Record<string, string> | null | undefined, locale: string): string {
  if (!record) return "";
  return record[locale] ?? record["en"] ?? Object.values(record)[0] ?? "";
}

/** Convert tetri integer to GEL display string. e.g. 550 → "5.50 ₾" */
function formatPrice(tetri: number): string {
  return (tetri / 100).toFixed(2) + " ₾";
}

// ─── SEO ──────────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchQuery(api.publicMenu.get, { slug });

  if (!data) {
    return {
      title: "Café Not Found",
      description: "This café menu could not be found.",
    };
  }

  return {
    title: `${data.organization.name} — Menu`,
    description: `Browse the full menu of ${data.organization.name}.`,
    openGraph: {
      title: `${data.organization.name} — Menu`,
      description: `Browse the full menu of ${data.organization.name}.`,
      ...(data.organization.logoUrl ? { images: [data.organization.logoUrl] } : {}),
    },
  };
}

// ─── 404 State ────────────────────────────────────────────────────────────────

function NotFound({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-center px-6">
      <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
        <UtensilsCrossed className="h-7 w-7 text-zinc-500" />
      </div>
      <h1 className="text-2xl font-medium text-white mb-2">Café Not Found</h1>
      <p className="text-sm text-zinc-400 max-w-xs">
        We couldn&apos;t find a menu for <span className="font-mono text-zinc-300">{slug}</span>. Check the URL and try again.
      </p>
    </div>
  );
}

// ─── Item Card ────────────────────────────────────────────────────────────────

function ItemCard({ item, locale }: { item: MenuItem; locale: string }) {
  const name = t(item.name, locale);
  const description = t(item.description, locale);

  return (
    <div className="flex gap-4 p-4 rounded-[var(--theme-radius,0.5rem)] border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] transition-all duration-200">
      {/* Image */}
      <div
        className="h-20 w-20 shrink-0 overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center"
        style={{ borderRadius: "var(--theme-radius, 0.5rem)" }}
      >
        {item.imageUrl ? (
          <MenuImage
            src={item.imageUrl.replace(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ?? "", "")}
            alt={name}
            width={80}
            height={80}
            className="object-cover w-full h-full"
          />
        ) : (
          <UtensilsCrossed className="h-6 w-6 text-zinc-600" />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-white text-sm leading-snug">{name}</p>
          <p
            className="text-sm font-semibold tabular-nums shrink-0"
            style={{ color: "var(--theme-primary, #ffffff)" }}
          >
            {formatPrice(item.price)}
          </p>
        </div>
        {description && (
          <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">{description}</p>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-white/10 text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PublicMenuPage({ params }: Props) {
  const { slug, locale } = await params;
  const data = await fetchQuery(api.publicMenu.get, { slug });

  if (!data) return <NotFound slug={slug} />;

  const { organization, categories } = data;

  // CSS variables injected from themeSettings
  const themeVars = {
    "--theme-primary": organization.themeSettings?.primaryColor ?? "#ffffff",
    "--theme-font": organization.themeSettings?.fontFamily ?? "Inter",
    "--theme-radius": organization.themeSettings?.buttonRadius ?? "0.5rem",
  } as React.CSSProperties;

  return (
    <div
      className="min-h-screen bg-zinc-950 text-white"
      style={{
        ...themeVars,
        fontFamily: "var(--theme-font), system-ui, sans-serif",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur-xl border-b border-white/8">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {organization.logoUrl ? (
            <div
              className="h-9 w-9 overflow-hidden border border-white/15 shrink-0"
              style={{ borderRadius: "var(--theme-radius, 0.5rem)" }}
            >
              <Image
                src={organization.logoUrl}
                alt={organization.name}
                width={36}
                height={36}
                className="object-cover w-full h-full"
              />
            </div>
          ) : (
            <div
              className="h-9 w-9 bg-white/10 border border-white/15 flex items-center justify-center shrink-0"
              style={{ borderRadius: "var(--theme-radius, 0.5rem)" }}
            >
              <span
                className="text-sm font-bold"
                style={{ color: "var(--theme-primary, #ffffff)" }}
              >
                {organization.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <h1 className="text-base font-semibold text-white leading-none">{organization.name}</h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {categories.reduce((sum, c) => sum + c.items.length, 0)} items · {organization.currency}
            </p>
          </div>
        </div>

        {/* ── Category tabs ──────────────────────────────────────────────── */}
        {categories.length > 1 && (
          <div className="max-w-2xl mx-auto px-4 pb-3 overflow-x-auto scrollbar-none">
            <div className="flex gap-2 w-max">
              {categories.map((cat) => (
                <a
                  key={cat._id}
                  href={`#cat-${cat._id}`}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:border-white/25 transition-all whitespace-nowrap"
                  style={{ scrollBehavior: "smooth" }}
                >
                  {t(cat.name, locale)}
                </a>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ── Menu body ──────────────────────────────────────────────────────── */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-10 pb-24">
        {categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <UtensilsCrossed className="h-8 w-8 text-zinc-600" />
            <p className="text-zinc-400 text-sm">Menu is being prepared. Check back soon!</p>
          </div>
        ) : (
          categories.map((cat) => (
            <section key={cat._id} id={`cat-${cat._id}`} className="scroll-mt-28">
              {/* Category heading */}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-lg font-semibold text-white">{t(cat.name, locale)}</h2>
                <div className="flex-1 h-px bg-white/8" />
                <span className="text-xs text-zinc-500">{cat.items.length}</span>
              </div>

              {/* Items */}
              {cat.items.length === 0 ? (
                <p className="text-sm text-zinc-500 italic px-1">No items in this category yet.</p>
              ) : (
                <div className="space-y-3">
                  {cat.items.map((item) => (
                    <ItemCard key={item._id} item={item} locale={locale} />
                  ))}
                </div>
              )}
            </section>
          ))
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="fixed bottom-0 left-0 right-0 bg-zinc-950/80 backdrop-blur-xl border-t border-white/8 py-3 px-4 text-center">
        <p className="text-[11px] text-zinc-600">
          Powered by{" "}
          <span className="font-medium" style={{ color: "var(--theme-primary, #ffffff)" }}>
            Shemoqmedi
          </span>
        </p>
      </footer>
    </div>
  );
}
