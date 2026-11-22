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
const PAPER = "#F4F1EA";
const ORANGE = "#FF4D00";
const MUTED = "#6B665E";
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
  /** Small orange label above the text ("Jury results"). */
  eyebrow?: string;
  /** A wide image under the header (a site's screenshot), optionally linked. */
  image?: { src: string; alt: string; href?: string };
  /** Shown by inbox previews next to the subject; hidden in the email itself. */
  preheader?: string;
  /** Extra footer line(s), already HTML (why they get it, unsubscribe). */
  footerHtml?: string;
};

/**
 * Every Shemoqmedi email: a 600 px card on off-white with the crow and
 * wordmark on top, an optional eyebrow and image, the paragraphs, a black
 * pill button, then the footer (crow, links, why you get this). Table layout
 * and inline styles, so it holds in Gmail, Apple Mail and Outlook.
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
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}">${html}</p>`;
  const body = paragraphs.map(p).join("\n");
  const cta = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px"><tr><td style="border-radius:999px;background:${INK}">
<a href="${escapeHtml(button.href)}" style="display:inline-block;padding:15px 26px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:999px">${escapeHtml(button.label)}&nbsp;&nbsp;&#8599;</a>
</td></tr></table>`
    : "";
  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${ORANGE}">${escapeHtml(opts.eyebrow)}</p>`
    : "";
  const imgTag = opts.image
    ? `<img src="${escapeHtml(opts.image.src)}" alt="${escapeHtml(opts.image.alt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px;background:${PAPER}">`
    : "";
  const image = opts.image
    ? `<tr><td style="padding:0 32px 28px">${opts.image.href ? `<a href="${escapeHtml(opts.image.href)}" style="text-decoration:none">${imgTag}</a>` : imgTag}</td></tr>`
    : "";
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(opts.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`
    : "";
  const link = (href: string, label: string) =>
    `<a href="${base}${href}" style="color:${INK};text-decoration:none;font-weight:600">${label}</a>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${PAPER}">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:20px;overflow:hidden">
<tr><td style="height:4px;background:${ORANGE};line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:26px 32px 22px">
  <a href="${base}" style="text-decoration:none;color:${INK}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding-right:12px;vertical-align:middle"><img src="${logo}" alt="" width="44" height="33" style="display:block;border:0"></td>
    <td style="vertical-align:middle;font-family:${FONT};color:${INK}">
      <div style="font-size:17px;font-weight:800;letter-spacing:-.04em;text-transform:uppercase;line-height:1">Shemoqmedi</div>
      <div style="font-size:8px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;line-height:1;margin-top:5px">Space</div>
    </td>
  </tr></table>
  </a>
</td></tr>
${image}
<tr><td style="padding:0 32px 12px">
${eyebrow}
${body}
${cta}
${extra}
</td></tr>
<tr><td style="padding:24px 32px 30px;border-top:1px solid #EDEAE3">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:top;width:52px"><img src="${logo}" alt="Shemoqmedi" width="36" height="27" style="display:block;border:0"></td>
    <td style="vertical-align:top;font-family:${FONT};font-size:13px;line-height:1.55;color:${MUTED}">
      <div style="color:${INK};font-weight:700">Shemoqmedi</div>
      <div>Website awards, scored by an independent jury.</div>
      <div style="margin-top:10px">${link("/", "Websites")}&nbsp;&nbsp;·&nbsp;&nbsp;${link("/jury", "The jury")}&nbsp;&nbsp;·&nbsp;&nbsp;${link("/how-we-score", "How we score")}&nbsp;&nbsp;·&nbsp;&nbsp;${link("/submit", "Submit a site")}</div>
    </td>
  </tr></table>
  ${opts.footerHtml ? `<div style="margin-top:18px;font-family:${FONT};font-size:11px;line-height:1.5;color:#8A857C">${opts.footerHtml}</div>` : ""}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
