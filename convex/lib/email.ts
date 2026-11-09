// Sending email through Resend. Needs RESEND_API_KEY (and RESEND_FROM, a
// sender on a Resend-verified domain) on the Convex deployment; without the
// key nothing is sent and the caller gets the reason back.

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends one email. Returns an error message, or null when sent. */
export async function sendEmail(input: { to: string[]; subject: string; text: string; html: string }) {
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

/** Plain black-and-white email body with an optional button. */
export function emailHtml(paragraphs: string[], button?: { label: string; href: string }, extra = "") {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  const cta = button
    ? `<p><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#000;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(button.label)}</a></p>`
    : "";
  return `<div style="font-family:Inter,Arial,sans-serif;color:#000;max-width:560px;line-height:1.6">${body}${cta}${extra}</div>`;
}
