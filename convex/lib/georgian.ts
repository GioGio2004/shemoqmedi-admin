// Georgian → Latin for URLs (audit A-09): slugs and file names used to drop
// every Georgian letter, so "ქართული საიტი" became "site", "site-2", ...
// National system of romanization (2002), the one Georgian road signs use.

const MKHEDRULI: Record<string, string> = {
  ა: "a", ბ: "b", გ: "g", დ: "d", ე: "e", ვ: "v", ზ: "z", თ: "t", ი: "i", კ: "k", ლ: "l", მ: "m",
  ნ: "n", ო: "o", პ: "p", ჟ: "zh", რ: "r", ს: "s", ტ: "t", უ: "u", ფ: "p", ქ: "k", ღ: "gh", ყ: "q",
  შ: "sh", ჩ: "ch", ც: "ts", ძ: "dz", წ: "ts", ჭ: "ch", ხ: "kh", ჯ: "j", ჰ: "h",
};

/** Mtavruli capitals (U+1C90–U+1CBF) sit at a fixed offset from Mkhedruli (U+10D0–U+10FF). */
const MTAVRULI_OFFSET = 0x1c90 - 0x10d0;

/** Replace Georgian letters with their Latin spelling; anything else is left as it is. */
export function latinizeGeorgian(value: string) {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const base = code >= 0x1c90 && code <= 0x1cbf ? String.fromCodePoint(code - MTAVRULI_OFFSET) : ch;
    out += MKHEDRULI[base] ?? ch;
  }
  return out;
}
