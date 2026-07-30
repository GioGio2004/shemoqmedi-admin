// ─────────────────────────────────────────────────────────────────────────────
// ALLERGENS — the 14 substances causing allergies or intolerances that
// Georgian law (Technical Regulation on food information, Annex 1 — mirrors
// EU Reg. 1169/2011 Annex II) requires catering venues to declare for
// non-prepacked food, available BEFORE purchase for distance selling.
//
// menuItems.allergens stores canonical KEYS from this list (never free text —
// tags are marketing, allergens are a legal declaration). Renderers translate
// keys to the viewer's locale and must show them REGARDLESS of any
// "show tags" style toggle.
// ─────────────────────────────────────────────────────────────────────────────

export const ALLERGEN_KEYS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type AllergenKey = (typeof ALLERGEN_KEYS)[number];

export const ALLERGEN_LABELS: Record<
  AllergenKey,
  { en: string; ka: string; ru: string }
> = {
  gluten: { en: "Gluten", ka: "გლუტენი", ru: "Глютен" },
  crustaceans: { en: "Crustaceans", ka: "კიბოსნაირები", ru: "Ракообразные" },
  eggs: { en: "Eggs", ka: "კვერცხი", ru: "Яйца" },
  fish: { en: "Fish", ka: "თევზი", ru: "Рыба" },
  peanuts: { en: "Peanuts", ka: "არაქისი", ru: "Арахис" },
  soybeans: { en: "Soy", ka: "სოია", ru: "Соя" },
  milk: { en: "Milk", ka: "რძე", ru: "Молоко" },
  nuts: { en: "Tree nuts", ka: "კაკლოვნები", ru: "Орехи" },
  celery: { en: "Celery", ka: "ნიახური", ru: "Сельдерей" },
  mustard: { en: "Mustard", ka: "მდოგვი", ru: "Горчица" },
  sesame: { en: "Sesame", ka: "სეზამი", ru: "Кунжут" },
  sulphites: { en: "Sulphites", ka: "სულფიტები", ru: "Сульфиты" },
  lupin: { en: "Lupin", ka: "ლუპინი", ru: "Люпин" },
  molluscs: { en: "Molluscs", ka: "მოლუსკები", ru: "Моллюски" },
};

const KEY_SET = new Set<string>(ALLERGEN_KEYS);

export function isAllergenKey(key: string): key is AllergenKey {
  return KEY_SET.has(key);
}

/** Localized label for a stored key; unknown keys render as-is (fail loud). */
export function allergenLabel(key: string, locale: string): string {
  const entry = ALLERGEN_LABELS[key as AllergenKey];
  if (!entry) return key;
  if (locale === "ka") return entry.ka;
  if (locale === "ru") return entry.ru;
  return entry.en;
}
