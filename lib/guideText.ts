// The light text format of team guide sections (convex/guides.ts):
//
//   a blank line starts a new paragraph
//   "- " (or "* ") starts a bullet
//   "1. " starts a numbered step
//   URLs (http://, https://) become links
//
// Anything else is shown exactly as typed, line breaks included, so a
// message template can be copied as it is.

export type GuideBlock =
  | { type: "paragraph"; lines: string[] }
  | { type: "bullets"; items: string[] }
  | { type: "steps"; items: string[]; start: number };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const STEP = /^\s*(\d{1,3})[.)]\s+(.*)$/;

/** Split section text into paragraphs, bullet lists and numbered steps. */
export function parseGuideText(text: string): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let current: GuideBlock | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    const step = bullet ? null : STEP.exec(line);
    if (bullet) {
      if (current?.type !== "bullets") {
        flush();
        current = { type: "bullets", items: [] };
      }
      current.items.push(bullet[1]);
    } else if (step) {
      if (current?.type !== "steps") {
        flush();
        current = { type: "steps", items: [], start: Number(step[1]) };
      }
      current.items.push(step[2]);
    } else if (current && current.type !== "paragraph") {
      // A line under a bullet or step without its own marker continues that item.
      current.items[current.items.length - 1] += `\n${line.trim()}`;
    } else {
      if (!current) current = { type: "paragraph", lines: [] };
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}

export type TextPart = { type: "text"; text: string } | { type: "link"; href: string; text: string };

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]'"»“”]+$/;

/** Text with its http(s) URLs as links (a full stop or bracket after a URL stays text). */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const tail = TRAILING.exec(url)?.[0] ?? "";
    if (tail) url = url.slice(0, -tail.length);
    const at = match.index ?? 0;
    if (at > last) parts.push({ type: "text", text: text.slice(last, at) });
    parts.push({ type: "link", href: url, text: url });
    last = at + url.length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

/** The {placeholders} still in a message, in order, without duplicates. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^{}\n]{1,60})\}/g)].map((m) => m[1].trim()))];
}
