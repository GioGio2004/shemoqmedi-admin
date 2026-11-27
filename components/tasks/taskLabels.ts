// Names and helpers for team tasks (convex/tasks.ts), shared by the admin and the docs.

export const TASK_KEY = "SHQ";

export const TASK_STATUSES = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "In review" },
  { value: "done", label: "Done" },
] as const;

export const TASK_PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

export const MEMBER_ROLES = [
  { value: "owner", label: "Owner" },
  { value: "developer", label: "Developer" },
  { value: "ops", label: "Ops assistant" },
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number]["value"];
export type TaskPriority = (typeof TASK_PRIORITIES)[number]["value"];
export type MemberRole = (typeof MEMBER_ROLES)[number]["value"];

export const statusLabel = (s: string) => TASK_STATUSES.find((x) => x.value === s)?.label ?? s;
export const priorityLabel = (p: string) => TASK_PRIORITIES.find((x) => x.value === p)?.label ?? p;
export const roleLabel = (r: string) => MEMBER_ROLES.find((x) => x.value === r)?.label ?? r;
export const taskKey = (n: number) => `${TASK_KEY}-${n}`;

/** Today in Tbilisi as "2026-11-27" (due dates are Tbilisi days). */
export function todayTbilisi(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "1 Dec" (and the year when it isn't this one). */
export function dueLabel(due: string, now = Date.now()) {
  const d = new Date(`${due}T12:00:00Z`);
  const sameYear = due.slice(0, 4) === todayTbilisi(now).slice(0, 4);
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(d);
}

export const isOverdue = (due: string | undefined, status: string, now = Date.now()) => !!due && status !== "done" && due < todayTbilisi(now);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** A checklist item id that is unique enough inside one task. */
export const newItemId = () => Math.random().toString(36).slice(2, 10);
