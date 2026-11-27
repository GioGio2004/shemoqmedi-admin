import type { CallToolResult } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ADMIN_APP_ORIGIN, DOCS_ORIGIN } from "@/lib/hosts";

// The connector's tools for the team guides (/guides) and tasks (/tasks):
// Claude writes and updates how-tos and assigns work, through the same Convex
// functions the admin uses (convex/guides.ts, convex/tasks.ts), which check
// the connector's admin credential. Deleting needs confirm: true, after
// Giorgi said yes in chat.

type Run = (fn: () => Promise<unknown>) => Promise<CallToolResult>;
type Auth = (ctx: unknown) => { token: string };

export const TEAM_INSTRUCTIONS = `Team guides and tasks (the admin's /guides and /tasks; the team reads them on docs.shemoqmedi.space):
- Guides are how-tos: a title, an area (networking, social, listings, jury, operations), who they are for (owner, developer, ops, everyone) and sections in order. A section is "steps" (plain text: blank line = paragraph, "- " bullets, "1. " steps, URLs link) or "template" (a message to copy, with {placeholders}; set language ka or en). Screenshots are added by Giorgi in the admin.
- New guides start as drafts, visible only in the admin. Mark one ready (update_guide status "ready") only when Giorgi says so: ready guides show to the team on the docs.
- Something only for Giorgi (call prep, notes on a person) stays a draft with roles ["owner"].
- Tasks are numbered SHQ-1, SHQ-2… Assign them to team members by name (list_team). A task can point at the guide to follow (guideSlug) and carry a checklist. The team moves status, ticks checklists and comments on the docs.
- Facts in guides and tasks must be true: the jury guide (https://www.shemoqmedi.space/jury/guide) and /submit are the sources. No company logos; an employer's name only with the person's confirmation.
- delete_guide, remove_guide_section and delete_task need confirm: true, only after Giorgi said yes in chat.`;

const area = z.enum(["networking", "social", "listings", "jury", "operations"]);
const role = z.enum(["everyone", "owner", "developer", "ops"]);
const sectionInput = z.object({
  kind: z.enum(["steps", "template"]).default("steps"),
  heading: z.string().min(1).max(140),
  body: z.string().max(10000).describe('Plain text: blank line = paragraph, "- " bullet, "1. " step; for a template, the message exactly as sent'),
  language: z.enum(["ka", "en"]).optional().describe("Templates only: the message's language"),
});
const status = z.enum(["todo", "in_progress", "review", "done"]);
const priority = z.enum(["low", "normal", "high", "urgent"]);
const memberRole = z.enum(["owner", "developer", "ops"]);

const guideLinks = (slug: string) => ({ admin: `${ADMIN_APP_ORIGIN}/guides/${slug}`, docs: `${DOCS_ORIGIN}/guides/${slug}` });
const taskLinks = (n: number) => ({ admin: `${ADMIN_APP_ORIGIN}/tasks/${n}`, docs: `${DOCS_ORIGIN}/tasks/${n}`, key: `SHQ-${n}` });

export function registerTeamTools(server: McpServer, convex: ConvexHttpClient, run: Run, auth: Auth) {
  async function guideBySlug(token: string, slug: string) {
    const guide = await convex.query(api.guides.get, { token, slug });
    if (!guide) throw new Error(`No guide "${slug}". list_guides shows them.`);
    return guide;
  }

  async function memberIds(token: string, names: string[] | undefined) {
    if (names === undefined) return undefined;
    const members = await convex.query(api.tasks.members, { token });
    return names.map((name) => {
      const n = name.trim().toLowerCase();
      const hit = members.find((m) => m.name.toLowerCase() === n) ?? members.filter((m) => m.name.toLowerCase().startsWith(n)).at(0);
      if (!hit) throw new Error(`Nobody called "${name}" on the team. list_team shows who is there; add_team_member adds someone.`);
      return hit.id;
    });
  }

  async function guideId(token: string, slug: string | null | undefined) {
    if (slug === undefined) return undefined;
    if (slug === null || slug === "") return null;
    return (await guideBySlug(token, slug)).id;
  }

  async function taskByNumber(token: string, number: number) {
    const task = await convex.query(api.tasks.get, { token, number });
    if (!task) throw new Error(`No task SHQ-${number}. list_tasks shows them.`);
    return task;
  }

  async function addSection(token: string, gid: Id<"guides">, s: z.infer<typeof sectionInput>) {
    const sectionId = await convex.mutation(api.guides.addSection, { token, guideId: gid, kind: s.kind });
    await convex.mutation(api.guides.updateSection, { token, sectionId, kind: s.kind, heading: s.heading, body: s.body, language: s.language, images: [] });
    return sectionId;
  }

  // ─── Guides ───────────────────────────────────────────────────────────────

  server.registerTool(
    "list_guides",
    { title: "List guides", description: "Every team guide: slug, title, area, who it is for, draft or ready, section count.", inputSchema: z.object({}) },
    async (_args, ctx) => run(() => convex.query(api.guides.list, auth(ctx))),
  );

  server.registerTool(
    "get_guide",
    { title: "Get guide", description: "One guide with its sections in order (ids, headings, text, screenshots).", inputSchema: z.object({ slug: z.string().min(1).max(80) }) },
    async (args, ctx) =>
      run(async () => {
        const g = await guideBySlug(auth(ctx).token, args.slug);
        return { ...g, links: guideLinks(g.slug) };
      }),
  );

  server.registerTool(
    "create_guide",
    {
      title: "Create guide",
      description: "A new guide (a draft, admin-only until marked ready) with its sections in order. Returns its slug and links.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        area,
        roles: z.array(role).min(1).describe('Who it is for; ["owner"] for something only Giorgi uses'),
        summary: z.string().max(280).optional().describe("One line: when to use it"),
        sections: z.array(sectionInput).max(80).default([]),
      }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const slug = await convex.mutation(api.guides.create, { token, title: args.title, area: args.area, roles: args.roles, summary: args.summary });
        const g = await guideBySlug(token, slug);
        for (const s of args.sections) await addSection(token, g.id, s);
        return { slug, status: "draft", sections: args.sections.length, links: guideLinks(slug) };
      }),
  );

  server.registerTool(
    "update_guide",
    {
      title: "Update guide",
      description: 'Change a guide\'s title, summary, area, who it is for, or status ("ready" shows it to the team on the docs: only when Giorgi says so).',
      inputSchema: z.object({
        slug: z.string().min(1).max(80),
        title: z.string().min(1).max(120).optional(),
        summary: z.string().max(280).optional(),
        area: area.optional(),
        roles: z.array(role).min(1).optional(),
        status: z.enum(["draft", "ready"]).optional(),
      }),
    },
    async ({ slug, ...rest }, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const g = await guideBySlug(token, slug);
        await convex.mutation(api.guides.update, { token, guideId: g.id, ...rest });
        return { ok: true, links: guideLinks(slug) };
      }),
  );

  server.registerTool(
    "add_guide_section",
    {
      title: "Add guide section",
      description: "Add a section at the end of a guide; move_guide_section moves it.",
      inputSchema: z.object({ slug: z.string().min(1).max(80), section: sectionInput }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const g = await guideBySlug(token, args.slug);
        return { sectionId: await addSection(token, g.id, args.section) };
      }),
  );

  server.registerTool(
    "update_guide_section",
    {
      title: "Update guide section",
      description: "Change a section's heading, text, kind or language (sectionId from get_guide). Its screenshots stay.",
      inputSchema: z.object({
        slug: z.string().min(1).max(80),
        sectionId: z.string(),
        kind: z.enum(["steps", "template"]).optional(),
        heading: z.string().min(1).max(140).optional(),
        body: z.string().max(10000).optional(),
        language: z.enum(["ka", "en"]).optional(),
      }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const g = await guideBySlug(token, args.slug);
        const s = g.sections.find((x) => x.id === args.sectionId);
        if (!s) throw new Error("No such section in this guide. get_guide lists the section ids.");
        const kind = args.kind ?? s.kind;
        await convex.mutation(api.guides.updateSection, {
          token,
          sectionId: s.id,
          kind,
          heading: args.heading ?? s.heading,
          body: args.body ?? s.body,
          language: args.language ?? s.language,
          images: s.images.map((i) => ({ mediaId: i.mediaId, caption: i.caption })),
        });
        return { ok: true };
      }),
  );

  server.registerTool(
    "move_guide_section",
    {
      title: "Move guide section",
      description: "Move a section one place up or down.",
      inputSchema: z.object({ sectionId: z.string(), direction: z.enum(["up", "down"]) }),
    },
    async (args, ctx) =>
      run(() => convex.mutation(api.guides.moveSection, { ...auth(ctx), sectionId: args.sectionId as Id<"guideSections">, direction: args.direction })),
  );

  server.registerTool(
    "remove_guide_section",
    {
      title: "Remove guide section",
      description: "Delete a section and its screenshots. confirm must be true, only after Giorgi said yes.",
      inputSchema: z.object({ sectionId: z.string(), confirm: z.literal(true) }),
    },
    async (args, ctx) => run(() => convex.mutation(api.guides.removeSection, { ...auth(ctx), sectionId: args.sectionId as Id<"guideSections"> })),
  );

  server.registerTool(
    "delete_guide",
    {
      title: "Delete guide",
      description: "Delete a whole guide, its sections and screenshots; tasks that followed it keep going without the link. confirm must be true, only after Giorgi said yes.",
      inputSchema: z.object({ slug: z.string().min(1).max(80), confirm: z.literal(true) }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const g = await guideBySlug(token, args.slug);
        await convex.mutation(api.guides.remove, { token, guideId: g.id });
        return { ok: true };
      }),
  );

  // ─── Team and tasks ───────────────────────────────────────────────────────

  server.registerTool(
    "list_team",
    { title: "List team", description: "The people tasks go to: name, role, account email, active, open tasks.", inputSchema: z.object({}) },
    async (_args, ctx) => run(() => convex.query(api.tasks.members, auth(ctx))),
  );

  server.registerTool(
    "add_team_member",
    {
      title: "Add team member",
      description: "Add someone to the team. email = the account they sign in to the docs with (shows them My tasks).",
      inputSchema: z.object({ name: z.string().min(1).max(80), role: memberRole, email: z.string().max(200).optional() }),
    },
    async (args, ctx) => run(() => convex.mutation(api.tasks.addMember, { ...auth(ctx), ...args })),
  );

  server.registerTool(
    "update_team_member",
    {
      title: "Update team member",
      description: 'Change a team member\'s name, role, account email ("" clears it) or mark them away (active false).',
      inputSchema: z.object({
        memberId: z.string(),
        name: z.string().min(1).max(80).optional(),
        role: memberRole.optional(),
        email: z.string().max(200).optional(),
        active: z.boolean().optional(),
      }),
    },
    async ({ memberId, ...rest }, ctx) =>
      run(() => convex.mutation(api.tasks.updateMember, { ...auth(ctx), memberId: memberId as Id<"teamMembers">, ...rest })),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description: "The task board: open tasks and those done in the last 30 days, with assignees, priority, due date, guide and checklist progress.",
      inputSchema: z.object({ status: status.optional(), assignee: z.string().max(80).optional().describe("A team member's name") }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const board = await convex.query(api.tasks.board, { token });
        const who = args.assignee?.trim().toLowerCase();
        return board.tasks
          .filter((t) => !args.status || t.status === args.status)
          .filter((t) => !who || t.assignees.some((a) => a.name.toLowerCase().startsWith(who)))
          .map((t) => ({ ...t, ...taskLinks(t.number) }));
      }),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description: "One task (SHQ-<number>): description, checklist with item ids, comments and details.",
      inputSchema: z.object({ number: z.number().int().min(1) }),
    },
    async (args, ctx) =>
      run(async () => {
        const t = await taskByNumber(auth(ctx).token, args.number);
        return { ...t, links: taskLinks(args.number) };
      }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description: "A new task in To do. Assign by team member names (list_team); guideSlug links the guide to follow.",
      inputSchema: z.object({
        title: z.string().min(1).max(160),
        description: z.string().max(10000).optional(),
        assignees: z.array(z.string().min(1).max(80)).max(10).optional(),
        priority: priority.optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Tbilisi day, e.g. 2026-12-01"),
        guideSlug: z.string().max(80).optional(),
        checklist: z.array(z.string().min(1).max(240)).max(40).optional(),
      }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const n = await convex.mutation(api.tasks.create, {
          token,
          title: args.title,
          description: args.description,
          assigneeIds: await memberIds(token, args.assignees),
          priority: args.priority,
          dueDate: args.dueDate,
          guideId: (await guideId(token, args.guideSlug)) ?? undefined,
          checklist: args.checklist?.map((text, i) => ({ id: `i${i + 1}`, text, done: false })),
        });
        return taskLinks(n);
      }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        'Change a task: title, description, status, priority, assignees (names, replaces the list), dueDate ("" clears), guideSlug ("" unlinks), checklist (replaces it; items keep their done state when the text is the same).',
      inputSchema: z.object({
        number: z.number().int().min(1),
        title: z.string().min(1).max(160).optional(),
        description: z.string().max(10000).optional(),
        status: status.optional(),
        priority: priority.optional(),
        assignees: z.array(z.string().min(1).max(80)).max(10).optional(),
        dueDate: z.string().max(10).optional(),
        guideSlug: z.string().max(80).optional(),
        checklist: z.array(z.string().min(1).max(240)).max(40).optional(),
      }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const t = await taskByNumber(token, args.number);
        const checklist = args.checklist?.map((text, i) => {
          const same = t.checklist.find((x) => x.text === text.trim());
          return same ?? { id: `i${Date.now().toString(36)}${i}`, text, done: false };
        });
        const g = await guideId(token, args.guideSlug);
        await convex.mutation(api.tasks.update, {
          token,
          taskId: t.card.id,
          title: args.title,
          description: args.description,
          status: args.status,
          priority: args.priority,
          assigneeIds: await memberIds(token, args.assignees),
          dueDate: args.dueDate,
          guideId: g === undefined ? undefined : g,
          checklist,
        });
        return { ok: true, ...taskLinks(args.number) };
      }),
  );

  server.registerTool(
    "tick_task_item",
    {
      title: "Tick task checklist item",
      description: "Tick or untick one checklist item (itemId from get_task).",
      inputSchema: z.object({ number: z.number().int().min(1), itemId: z.string(), done: z.boolean() }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const t = await taskByNumber(token, args.number);
        await convex.mutation(api.tasks.toggleItem, { token, taskId: t.card.id, itemId: args.itemId, done: args.done });
        return { ok: true };
      }),
  );

  server.registerTool(
    "comment_on_task",
    {
      title: "Comment on task",
      description: "Add a comment to a task, signed as the connected admin.",
      inputSchema: z.object({ number: z.number().int().min(1), body: z.string().min(1).max(4000) }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const t = await taskByNumber(token, args.number);
        await convex.mutation(api.tasks.addComment, { token, taskId: t.card.id, body: args.body });
        return { ok: true };
      }),
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete task",
      description: "Delete a task and its comments. confirm must be true, only after Giorgi said yes.",
      inputSchema: z.object({ number: z.number().int().min(1), confirm: z.literal(true) }),
    },
    async (args, ctx) =>
      run(async () => {
        const { token } = auth(ctx);
        const t = await taskByNumber(token, args.number);
        await convex.mutation(api.tasks.remove, { token, taskId: t.card.id });
        return { ok: true };
      }),
  );
}
