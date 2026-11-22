// Sending email through Resend. Needs RESEND_API_KEY (and RESEND_FROM, a
// sender on a Resend-verified domain) on the Convex deployment; without the
// key nothing is sent and the caller gets the reason back.

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends one email. Returns an error message, or null when sent. */
export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return "RESEND_API_KEY is not set on this Convex deployment.";
  if (input.to.length === 0) return "No recipient.";
  const from = process.env.RESEND_FROM?.trim() || "Shemoqmedi <awards@shemoqmedi.space>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...input }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return `Resend refused the email (${res.status}). ${body.slice(0, 200)}`.trim();
    }
    return null;
  } catch (err) {
    return `Could not reach Resend: ${(err as Error).message}`;
  }
}

const DEFAULT_SITE = "https://www.shemoqmedi.space";
const site = () => (process.env.SITE_URL?.trim() || DEFAULT_SITE).replace(/\/+$/, "");

const INK = "#0A0A0A";
const ORANGE = "#FF4D00";
const FONT = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";

/**
 * An image URL email clients can show: ImageKit images are asked for as a
 * JPEG at email width (Outlook and older Gmail apps don't show WebP or SVG).
 * Anything else is returned as it is.
 */
export function emailImageUrl(url: string, width = 1120) {
  try {
    const u = new URL(url);
    if (u.hostname !== "ik.imagekit.io") return url;
    u.searchParams.set("tr", `w-${width},f-jpg,q-80`);
    return u.toString();
  } catch {
    return url;
  }
}

export type EmailOptions = {
  /** Small orange label above the headline ("Jury results"). */
  eyebrow?: string;
  /** Big headline at the top of the email ("AVARA won Best Solo Creation"). */
  headline?: string;
  /** A wide image (a site's screenshot), optionally linked. */
  image?: { src: string; alt: string; href?: string };
  /** Where the image sits: under the header (default) or after the sections. */
  imageAt?: "top" | "bottom";
  /** Award badges (PNG), centred under the headline, each shown `width` px wide. */
  badges?: { src: string; alt: string; href?: string; width: number }[];
  /** The main action: a full-width orange button, with its link written out below. */
  primary?: { label: string; href: string };
  /** Titled blocks after the text (score card, reviews), already HTML. */
  sections?: { title: string; html: string }[];
  /** Shown by inbox previews next to the subject; hidden in the email itself. */
  preheader?: string;
  /** Extra footer line(s), already HTML (why they get it, unsubscribe). */
  footerHtml?: string;
};

const fmt2 = (n: number) => n.toFixed(2);

/**
 * The jury's verdict as an email block: the final score large, then each
 * criterion with its weight and an orange bar. Black, white and orange only.
 */
export function scoreCardHtml(input: {
  final: number;
  jurors: number;
  pillars: { name: string; weight: number; value: number }[];
}) {
  const rows = input.pillars
    .map((p) => {
      const pct = Math.max(2, Math.min(100, Math.round(p.value * 10)));
      return `<tr>
<td style="padding:10px 0;font-family:${FONT};font-size:14px;color:${INK};width:150px">${escapeHtml(p.name)} <span style="font-size:11px">${Math.round(p.weight * 100)}%</span></td>
<td style="padding:10px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${INK};border-radius:999px;overflow:hidden"><tr>
    <td width="${pct}%" style="height:8px;background:${ORANGE};font-size:0;line-height:0">&nbsp;</td>
    <td style="height:8px;background:#FFFFFF;font-size:0;line-height:0">&nbsp;</td>
  </tr></table>
</td>
<td align="right" style="padding:10px 0;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};width:48px">${fmt2(p.value)}</td>
</tr>`;
    })
    .join("");
  const basis =
    input.jurors > 0
      ? `Average of ${input.jurors} ${input.jurors === 1 ? "juror's" : "jurors'"} weighted scores`
      : "Set by the Shemoqmedi team";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${INK};border-radius:16px">
<tr><td style="padding:24px 24px 8px">
  <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${ORANGE}">Final score</div>
  <div style="font-family:${FONT};color:${INK};margin-top:6px"><span style="font-size:56px;font-weight:800;letter-spacing:-.04em;line-height:1">${fmt2(input.final)}</span><span style="font-size:18px;font-weight:700"> / 10</span></div>
  <div style="font-family:${FONT};font-size:13px;color:${INK};margin-top:8px">${basis}</div>
</td></tr>
<tr><td style="padding:8px 24px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
</table>`;
}

/** Each juror's review as a card: name, role, score, comment. */
export function reviewCardsHtml(reviews: { name: string; title: string; score: number; comment: string }[]) {
  return reviews
    .map((r) => {
      const role = r.title ? `<div style="font-size:12px;margin-top:2px">${escapeHtml(r.title)}</div>` : "";
      const comment = r.comment.trim()
        ? `<div style="font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};margin-top:12px">${escapeHtml(r.comment.trim()).replace(/\n/g, "<br>")}</div>`
        : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${INK};border-radius:14px;margin:0 0 12px"><tr><td style="padding:18px 20px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="font-family:${FONT};color:${INK}"><div style="font-size:15px;font-weight:700">${escapeHtml(r.name)}</div>${role}</td>
    <td align="right" style="font-family:${FONT};font-size:22px;font-weight:800;color:${ORANGE};vertical-align:top">${fmt2(r.score)}</td>
  </tr></table>
  ${comment}
</td></tr></table>`;
    })
    .join("");
}

/**
 * Every Shemoqmedi email: a 600 px white card on black with the crow and
 * wordmark on top, then (each optional) a screenshot, an orange label, a big
 * headline, award badges, the paragraphs, a full-width orange main button
 * with its link written out, titled sections (score card, reviews), a black
 * secondary button, and the footer (crow, links, why you get this). Black,
 * white and orange only. Table layout and inline styles, so it holds in
 * Gmail, Apple Mail and Outlook.
 */
export function emailHtml(
  paragraphs: string[],
  button?: { label: string; href: string },
  extra = "",
  opts: EmailOptions = {},
) {
  const base = site();
  const logo = `${base}/brand/crow.png`;
  const p = (html: string) =>
    `<p style="margin:0 0 18px;font-family:${FONT};font-size:16px;line-height:1.65;color:${INK}">${html}</p>`;
  const body = paragraphs.map(p).join("\n");
  const secondary = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px"><tr><td style="border-radius:999px;background:${INK}">
<a href="${escapeHtml(button.href)}" style="display:inline-block;padding:15px 26px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:999px">${escapeHtml(button.label)}&nbsp;&nbsp;&#8599;</a>
</td></tr></table>`
    : "";
  const primary = opts.primary
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 12px"><tr><td align="center" style="border-radius:16px;background:${ORANGE}">
<a href="${escapeHtml(opts.primary.href)}" style="display:block;padding:22px 24px;font-family:${FONT};font-size:16px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:16px">${escapeHtml(opts.primary.label)}&nbsp;&nbsp;&#8599;</a>
</td></tr></table>
<p style="margin:0 0 28px;font-family:${FONT};font-size:12px;line-height:1.5;color:${INK};text-align:center">Button not working? Open this link:<br><a href="${escapeHtml(opts.primary.href)}" style="color:${ORANGE};word-break:break-all">${escapeHtml(opts.primary.href)}</a></p>`
    : "";
  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${ORANGE}">${escapeHtml(opts.eyebrow)}</p>`
    : "";
  const headline = opts.headline
    ? `<h1 style="margin:0 0 22px;font-family:${FONT};font-size:34px;line-height:1.08;font-weight:800;letter-spacing:-.035em;color:${INK}">${escapeHtml(opts.headline)}</h1>`
    : "";
  const imgTag = opts.image
    ? `<img src="${escapeHtml(opts.image.src)}" alt="${escapeHtml(opts.image.alt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px;border:1px solid ${INK}">`
    : "";
  const imageRow = (pad: string) =>
    opts.image
      ? `<tr><td style="padding:${pad}">${opts.image.href ? `<a href="${escapeHtml(opts.image.href)}" style="text-decoration:none">${imgTag}</a>` : imgTag}</td></tr>`
      : "";
  const imageTop = opts.imageAt === "bottom" ? "" : imageRow("0 32px 30px");
  const imageBottom = opts.imageAt === "bottom" ? imageRow("8px 32px 8px") : "";
  const badgeImg = (b: NonNullable<EmailOptions["badges"]>[number]) => {
    const img = `<img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}" width="${b.width}" style="display:inline-block;width:${b.width}px;max-width:100%;height:auto;border:0">`;
    return b.href ? `<a href="${escapeHtml(b.href)}" style="text-decoration:none">${img}</a>` : img;
  };
  const badges = opts.badges?.length
    ? `<div style="text-align:center;margin:6px 0 26px">${opts.badges.map((b) => `<div style="margin:0 0 14px">${badgeImg(b)}</div>`).join("")}</div>`
    : "";
  const sections = (opts.sections ?? [])
    .map(
      (s) => `<tr><td style="padding:12px 32px 18px">
<p style="margin:0 0 14px;font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-.02em;color:${INK}">${escapeHtml(s.title)}</p>
${s.html}
</td></tr>`,
    )
    .join("\n");
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(opts.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`
    : "";
  const link = (href: string, label: string) =>
    `<a href="${base}${href}" style="color:${ORANGE};text-decoration:none;font-weight:700">${label}</a>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${INK}">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${INK}">
<tr><td align="center" style="padding:36px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:20px;overflow:hidden">
<tr><td style="height:6px;background:${ORANGE};line-height:6px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 26px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle"><a href="${base}" style="text-decoration:none;color:${INK}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:12px;vertical-align:middle"><img src="${logo}" alt="" width="44" height="33" style="display:block;border:0"></td>
        <td style="vertical-align:middle;font-family:${FONT};color:${INK}">
          <div style="font-size:17px;font-weight:800;letter-spacing:-.04em;text-transform:uppercase;line-height:1">Shemoqmedi</div>
          <div style="font-size:8px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;line-height:1;margin-top:5px">Space</div>
        </td>
      </tr></table>
    </a></td>
    <td align="right" style="vertical-align:middle;font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${INK}">Website awards</td>
  </tr></table>
</td></tr>
${imageTop}
<tr><td style="padding:0 32px 8px">
${eyebrow}
${headline}
${badges}
${body}
${primary}
</td></tr>
${sections}
${imageBottom}
<tr><td style="padding:8px 32px 20px">
${secondary}
${extra}
</td></tr>
<tr><td style="padding:26px 32px 32px;border-top:2px solid ${ORANGE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:top;width:52px"><img src="${logo}" alt="Shemoqmedi" width="36" height="27" style="display:block;border:0"></td>
    <td style="vertical-align:top;font-family:${FONT};font-size:13px;line-height:1.55;color:${INK}">
      <div style="font-weight:700">Shemoqmedi</div>
      <div>Website awards, scored by an independent jury.</div>
      <div style="margin-top:10px">${link("/", "Websites")}&nbsp;&nbsp;·&nbsp;&nbsp;${link("/jury", "The jury")}&nbsp;&nbsp;·&nbsp;&nbsp;${link("/how-we-score", "How we score")}&nbsp;&nbsp;·&nbsp;&nbsp;${link("/submit", "Submit a site")}</div>
    </td>
  </tr></table>
  ${opts.footerHtml ? `<div style="margin-top:18px;font-family:${FONT};font-size:11px;line-height:1.5;color:${INK}">${opts.footerHtml}</div>` : ""}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
