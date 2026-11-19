// What a pending action (convex/pendingActions.ts) will do, in plain words,
// for the approval lists in the admin (Social) and the Studio (Queue). Both
// show the same facts: who gets it, the subject and text, or the post's
// networks, captions and media, so an admin approves exactly what goes out.

export type PendingKind = "send_email" | "send_broadcast" | "publish_post" | "retry_post";

export type PendingRow = {
  kind: PendingKind;
  payload: unknown;
  summary: string;
  changed: boolean;
};

export type Described = {
  /** "Email", "Broadcast", "Publish post", "Retry post". */
  label: string;
  /** Label + value pairs, in order (recipient, audience size, subject, networks…). */
  facts: { label: string; value: string }[];
  /** The full text that goes out: the email body, or each network's caption. */
  texts: { label: string; text: string }[];
  media: { kind: "image" | "video"; url: string; networks?: string[] }[];
  /** A sentence for the confirm step ("Email 412 people?"), when one is wise. */
  confirm: string | null;
  /** Why it can't be approved as it is, or null. */
  problem: string | null;
};

const NETWORK_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads", linkedin: "LinkedIn" };
const AUDIENCE_LABEL: Record<string, string> = {
  users: "Everyone with an account",
  studios: "Studios (contact emails and owners)",
  jurors: "Active jurors",
  all: "Everyone",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function when(at: unknown): string {
  return typeof at === "number" && at > Date.now() ? new Date(at).toLocaleString() : "Now";
}

export function describePending(row: PendingRow): Described {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  if (row.kind === "send_email") {
    return {
      label: "Email",
      facts: [
        { label: "To", value: str(p.to) },
        { label: "Subject", value: str(p.subject) },
      ],
      texts: [{ label: "Body", text: str(p.text) }],
      media: [],
      confirm: null,
      problem: null,
    };
  }
  if (row.kind === "send_broadcast") {
    const recipients = num(p.recipients);
    const sample = Array.isArray(p.sample) ? p.sample.filter((s): s is string => typeof s === "string") : [];
    return {
      label: "Broadcast",
      facts: [
        { label: "Audience", value: AUDIENCE_LABEL[str(p.audience)] ?? str(p.audience) },
        { label: "Recipients", value: `${recipients} ${recipients === 1 ? "person" : "people"} (counted when Claude asked)` },
        ...(sample.length ? [{ label: "First addresses", value: sample.join(", ") }] : []),
        { label: "Subject", value: str(p.subject) },
      ],
      texts: [{ label: "Body", text: str(p.body) }],
      media: [],
      confirm: `Email the whole audience (about ${recipients} ${recipients === 1 ? "person" : "people"})? This can't be undone.`,
      problem: null,
    };
  }
  const snapshot = (p.snapshot ?? {}) as Record<string, unknown>;
  const captions = (snapshot.captions ?? {}) as Record<string, unknown>;
  const networks = Array.isArray(snapshot.networks) ? snapshot.networks.filter((n): n is string => typeof n === "string") : [];
  const media = Array.isArray(snapshot.media)
    ? (snapshot.media as { kind?: unknown; url?: unknown; networks?: unknown }[])
        .filter((m) => typeof m.url === "string")
        .map((m) => ({
          kind: m.kind === "video" ? ("video" as const) : ("image" as const),
          url: m.url as string,
          ...(Array.isArray(m.networks) ? { networks: m.networks.filter((n): n is string => typeof n === "string") } : {}),
        }))
    : [];
  const retry = row.kind === "retry_post" || p.mode === "retry";
  const at = p.mode === "publish" ? p.at : snapshot.scheduledFor;
  return {
    label: retry ? "Retry post" : "Publish post",
    facts: [
      { label: "Post", value: str(p.title) || "Post" },
      { label: "Networks", value: networks.map((n) => NETWORK_LABEL[n] ?? n).join(", ") || "None" },
      { label: "When", value: retry ? "Now (only networks not sent yet)" : when(at) },
      ...(snapshot.placement === "story" ? [{ label: "Placement", value: "Story" }] : []),
    ],
    texts: Object.entries(captions)
      .filter(([, text]) => typeof text === "string" && text.trim())
      .map(([network, text]) => ({ label: NETWORK_LABEL[network] ?? network, text: text as string })),
    media,
    confirm: null,
    problem: row.changed ? "The post changed after Claude asked. Reject this and look at the post again." : null,
  };
}
