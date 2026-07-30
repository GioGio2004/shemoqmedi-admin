"use client";

import type { StudioConfig } from "@/convex/studioConfig";
import { allergenLabel } from "@/convex/allergens";
import { formatPrice, tr, withAlpha } from "./presets";

// ─────────────────────────────────────────────────────────────────────────────
// The five menu-item card components. Every visual decision comes from the
// StudioConfig — colors/fonts/radius arrive as CSS vars set on the preview
// root (--sd-*), so cards only deal in layout.
// ─────────────────────────────────────────────────────────────────────────────

export type PreviewItem = {
  id: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  price: number;
  imageUrl: string | null;
  tags: string[];
  /** Canonical allergen keys (convex/allergens.ts) — legal declaration. */
  allergens?: string[];
  isFeatured: boolean;
};

const RATIO: Record<StudioConfig["cards"]["imageRatio"], string> = {
  square: "1 / 1",
  portrait: "3 / 4",
  landscape: "16 / 10",
};

/** Image or an accent-tinted placeholder so image-less items still compose. */
function CardImage({
  item,
  locale,
  ratio,
  className = "",
  showImage = true,
}: {
  item: PreviewItem;
  locale: string;
  ratio: string;
  className?: string;
  /** When false, always render the placeholder (mirrors the live renderer). */
  showImage?: boolean;
}) {
  if (showImage && item.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.imageUrl}
        alt={tr(item.name, locale)}
        loading="lazy"
        className={`w-full object-cover ${className}`}
        style={{ aspectRatio: ratio, borderRadius: "var(--sd-radius)" }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`flex w-full items-center justify-center ${className}`}
      style={{
        aspectRatio: ratio,
        borderRadius: "var(--sd-radius)",
        background:
          "linear-gradient(135deg, var(--sd-accent-08), var(--sd-ink-06))",
      }}
    >
      <span
        className="font-medium"
        style={{ color: "var(--sd-accent)", fontSize: 20, opacity: 0.7 }}
      >
        {tr(item.name, locale).charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function Price({
  value,
  style,
  currency,
}: {
  value: number;
  style: StudioConfig["cards"]["priceStyle"];
  currency?: string;
}) {
  if (style === "badge") {
    return (
      <span
        className="inline-block shrink-0 px-2 py-0.5 text-[11px] font-semibold tabular-nums"
        style={{
          background: "var(--sd-accent)",
          color: "var(--sd-accent-ink)",
          borderRadius: "calc(var(--sd-radius) * 0.75)",
        }}
      >
        {formatPrice(value, currency)}
      </span>
    );
  }
  return (
    <span
      className="shrink-0 text-[12px] font-semibold tabular-nums"
      style={{ color: "var(--sd-ink)" }}
    >
      {formatPrice(value, currency)}
    </span>
  );
}

/** Name + price row; renders the dotted leader when priceStyle is "dotted". */
function TitleRow({
  item,
  locale,
  cards,
  currency,
}: {
  item: PreviewItem;
  locale: string;
  cards: StudioConfig["cards"];
  currency?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="min-w-0 text-[13px] font-semibold leading-snug"
        style={{ color: "var(--sd-ink)", fontFamily: "var(--sd-font-heading)" }}
      >
        {tr(item.name, locale)}
      </span>
      {cards.priceStyle === "dotted" && (
        <span
          aria-hidden
          className="mx-0.5 flex-1 border-b border-dotted"
          style={{ borderColor: "var(--sd-ink-25)", minWidth: 12 }}
        />
      )}
      {cards.priceStyle !== "dotted" && <span className="flex-1" />}
      <Price value={item.price} style={cards.priceStyle} currency={currency} />
    </div>
  );
}

function Description({
  item,
  locale,
}: {
  item: PreviewItem;
  locale: string;
}) {
  const text = tr(item.description, locale);
  if (!text) return null;
  return (
    <p
      className="text-[11px] leading-relaxed"
      style={{ color: "var(--sd-ink-60)", fontFamily: "var(--sd-font-body)" }}
    >
      {text}
    </p>
  );
}

function Tags({ item }: { item: PreviewItem }) {
  if (!item.tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {item.tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
          style={{
            color: "var(--sd-ink-60)",
            border: "1px solid var(--sd-ink-14)",
            borderRadius: "calc(var(--sd-radius) * 0.5)",
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

/** Allergen declaration — mirrors the live renderer: NOT gated by showTags. */
function Allergens({
  item,
  locale,
  onDark = false,
}: {
  item: PreviewItem;
  locale: string;
  onDark?: boolean;
}) {
  if (!item.allergens?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {item.allergens.map((key) => (
        <span
          key={key}
          className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
          style={{
            color: onDark ? "#FFD48A" : "var(--sd-ink)",
            border: onDark
              ? "1px solid rgba(255, 212, 138, 0.5)"
              : "1px solid var(--sd-ink-60)",
            borderRadius: "calc(var(--sd-radius) * 0.5)",
          }}
        >
          {allergenLabel(key, locale)}
        </span>
      ))}
    </div>
  );
}

// ── The five variants ────────────────────────────────────────────────────────

export function ItemCard({
  item,
  locale,
  cards,
  currency,
}: {
  item: PreviewItem;
  locale: string;
  cards: StudioConfig["cards"];
  currency?: string;
}) {
  const ratio = RATIO[cards.imageRatio];

  switch (cards.variant) {
    // Image top, text below — the safe default.
    case "classic":
      return (
        <div
          className="sd-card flex flex-col overflow-hidden"
          style={{
            background: "var(--sd-surface)",
            borderRadius: "var(--sd-radius)",
            border: "1px solid var(--sd-ink-08)",
          }}
        >
          {cards.showImages && (
            <CardImage
              item={item}
              locale={locale}
              ratio={ratio}
              className="!rounded-none"
            />
          )}
          <div
            className="flex flex-col"
            style={{ padding: "calc(10px * var(--sd-density))", gap: "calc(6px * var(--sd-density))" }}
          >
            <TitleRow item={item} locale={locale} cards={cards} currency={currency} />
            {cards.showDescriptions && <Description item={item} locale={locale} />}
            {cards.showTags && <Tags item={item} />}
            <Allergens item={item} locale={locale} />
          </div>
        </div>
      );

    // Ruled text rows — no imagery, price leads the eye.
    case "minimal":
      return (
        <div
          className="sd-card flex flex-col"
          style={{
            padding: "calc(10px * var(--sd-density)) 2px",
            gap: "calc(5px * var(--sd-density))",
            borderBottom: "1px solid var(--sd-ink-14)",
          }}
        >
          <TitleRow item={item} locale={locale} cards={cards} currency={currency} />
          {cards.showDescriptions && <Description item={item} locale={locale} />}
          {cards.showTags && <Tags item={item} />}
          <Allergens item={item} locale={locale} />
        </div>
      );

    // Image with a frosted plate riding the bottom edge.
    case "glass":
      return (
        <div
          className="sd-card relative overflow-hidden"
          style={{ borderRadius: "var(--sd-radius)" }}
        >
          <CardImage
            item={item}
            locale={locale}
            ratio={ratio}
            className="!rounded-none"
            showImage={cards.showImages}
          />
          <div
            className="absolute inset-x-1.5 bottom-1.5 backdrop-blur-md"
            style={{
              background: "var(--sd-surface-70)",
              borderRadius: "calc(var(--sd-radius) * 0.85)",
              border: "1px solid var(--sd-ink-08)",
              padding: "calc(8px * var(--sd-density))",
            }}
          >
            <TitleRow item={item} locale={locale} cards={cards} currency={currency} />
            {cards.showDescriptions && <Description item={item} locale={locale} />}
            {cards.showTags && <Tags item={item} />}
            <Allergens item={item} locale={locale} />
          </div>
        </div>
      );

    // Horizontal split — editorial list row with a small square image.
    case "editorial":
      return (
        <div
          className="sd-card flex items-center"
          style={{
            gap: "calc(10px * var(--sd-density))",
            padding: "calc(9px * var(--sd-density)) 2px",
            borderBottom: "1px solid var(--sd-ink-14)",
          }}
        >
          {cards.showImages && (
            <div className="w-14 shrink-0">
              <CardImage item={item} locale={locale} ratio="1 / 1" />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 3 }}>
            <TitleRow item={item} locale={locale} cards={cards} currency={currency} />
            {cards.showDescriptions && <Description item={item} locale={locale} />}
            {cards.showTags && <Tags item={item} />}
            <Allergens item={item} locale={locale} />
          </div>
        </div>
      );

    // Wide image, title burned into the lower edge.
    case "banner":
      return (
        <div
          className="sd-card relative overflow-hidden"
          style={{ borderRadius: "var(--sd-radius)" }}
        >
          <CardImage
            item={item}
            locale={locale}
            ratio="16 / 9"
            className="!rounded-none"
            showImage={cards.showImages}
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.72) 100%)",
            }}
          />
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ padding: "calc(10px * var(--sd-density))" }}
          >
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p
                  className="truncate text-[14px] font-semibold"
                  style={{ color: "#FFFFFF", fontFamily: "var(--sd-font-heading)" }}
                >
                  {tr(item.name, locale)}
                </p>
                {cards.showDescriptions && (
                  <p
                    className="truncate text-[10px]"
                    style={{ color: "rgba(255,255,255,0.75)" }}
                  >
                    {tr(item.description, locale)}
                  </p>
                )}
                {cards.showTags && (
                  <div className="mt-1">
                    <Tags item={item} />
                  </div>
                )}
                <div className="mt-1">
                  <Allergens item={item} locale={locale} onDark />
                </div>
              </div>
              <Price
                value={item.price}
                style={cards.priceStyle === "dotted" ? "plain" : cards.priceStyle}
                currency={currency}
              />
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

/** Compact card for the Featured strip. */
export function FeaturedCard({
  item,
  locale,
  wide = false,
  currency,
}: {
  item: PreviewItem;
  locale: string;
  wide?: boolean;
  currency?: string;
}) {
  return (
    <div
      className={`sd-card ${wide ? "w-44" : "w-32"} shrink-0 overflow-hidden`}
      style={{
        background: "var(--sd-surface)",
        borderRadius: "var(--sd-radius)",
        border: "1px solid var(--sd-accent-35)",
      }}
    >
      <CardImage item={item} locale={locale} ratio="4 / 3" className="!rounded-none" />
      <div style={{ padding: 8 }}>
        <p
          className="truncate text-[11px] font-semibold"
          style={{ color: "var(--sd-ink)", fontFamily: "var(--sd-font-heading)" }}
        >
          {tr(item.name, locale)}
        </p>
        <p
          className="mt-0.5 text-[10px] font-semibold tabular-nums"
          style={{ color: "var(--sd-accent)" }}
        >
          {formatPrice(item.price, currency)}
        </p>
      </div>
    </div>
  );
}

// Re-export for MenuPreview's convenience.
export { withAlpha };
