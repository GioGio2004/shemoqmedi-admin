"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { TASK_STATUSES, dueLabel, initials, isOverdue, priorityLabel, taskKey } from "./taskLabels";

// The task board, shared by the admin (/tasks) and the docs (/tasks): four
// columns by status, filtered by person. On the docs it opens on "My tasks"
// when the signed-in account belongs to a team member. Styled by the
// .tk-* classes in app/globals.css, which read each site's own colours.

export type BoardData = FunctionReturnType<typeof api.tasks.board>;
export type TaskCardData = BoardData["tasks"][number];

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

function TaskCard({ task }: { task: TaskCardData }) {
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <Link href={`/tasks/${task.number}`} className="tk-card" data-priority={task.priority}>
      <div className="tk-card-top">
        <span className="tk-key">{taskKey(task.number)}</span>
        {(task.priority === "high" || task.priority === "urgent") && <span className="tk-priority">{priorityLabel(task.priority)}</span>}
      </div>
      <p className="tk-card-title">{task.title}</p>
      {task.guide && <p className="tk-card-guide">Guide: {task.guide.title}</p>}
      <div className="tk-card-foot">
        <div className="tk-meta">
          {task.dueDate && (
            <span className="tk-due" data-overdue={overdue || undefined} title={overdue ? "Overdue" : "Due"}>
              {overdue ? "Overdue · " : ""}
              {dueLabel(task.dueDate)}
            </span>
          )}
          {task.checklistTotal > 0 && (
            <span title="Checklist done">
              {task.checklistDone}/{task.checklistTotal} done
            </span>
          )}
          {task.comments > 0 && (
            <span>
              {task.comments} comment{task.comments === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="tk-avatars">
          {task.assignees.length === 0 ? (
            <span className="tk-avatar tk-avatar-empty" title="Nobody yet">
              ?
            </span>
          ) : (
            task.assignees.map((a) => (
              <span key={a.id} className="tk-avatar" title={a.name}>
                {initials(a.name)}
              </span>
            ))
          )}
        </div>
      </div>
    </Link>
  );
}

/** The four columns, with a person filter. `mode` "docs" opens on My tasks. */
export function TaskBoard({ mode, toolbar }: { mode: "admin" | "docs"; toolbar?: React.ReactNode }) {
  const data = useQuery(api.tasks.board, {});
  const [who, setWho] = useState<string | null>(null); // member id, "none", or null = everyone
  const [search, setSearch] = useState("");

  // On the docs, a team member starts on their own tasks.
  const filter = who ?? (mode === "docs" && data?.me ? data.me.id : "all");

  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of data?.tasks ?? []) for (const a of t.assignees) map.set(a.id, a.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  if (data === undefined) return <p className="admin-eyebrow">Loading…</p>;

  const q = search.trim().toLowerCase();
  const shown = data.tasks
    .filter((t) => filter === "all" || (filter === "none" ? t.assignees.length === 0 : t.assignees.some((a) => a.id === filter)))
    .filter((t) => !q || t.title.toLowerCase().includes(q) || taskKey(t.number).toLowerCase() === q);

  return (
    <div className="tk-scope grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {data.me && (
          <button type="button" className="admin-toggle" aria-pressed={filter === data.me.id} onClick={() => setWho(data.me!.id)}>
            My tasks
          </button>
        )}
        <button type="button" className="admin-toggle" aria-pressed={filter === "all"} onClick={() => setWho("all")}>
          Everyone
        </button>
        {people
          .filter(([id]) => id !== data.me?.id)
          .map(([id, name]) => (
            <button key={id} type="button" className="admin-toggle" aria-pressed={filter === id} onClick={() => setWho(id)}>
              {name}
            </button>
          ))}
        <button type="button" className="admin-toggle" aria-pressed={filter === "none"} onClick={() => setWho("none")}>
          Unassigned
        </button>
        <input
          type="search"
          className="admin-input tk-search"
          placeholder="Search tasks or SHQ-12"
          aria-label="Search tasks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {toolbar}
      </div>

      <div className="tk-board">
        {TASK_STATUSES.map((col) => {
          const tasks = shown
            .filter((t) => t.status === col.value)
            .sort((a, b) =>
              col.value === "done"
                ? (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)
                : PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.number - b.number,
            );
          return (
            <section key={col.value} className="tk-column" aria-label={col.label}>
              <header className="tk-column-head">
                <span>{col.label}</span>
                <span className="tk-count">{tasks.length}</span>
              </header>
              <div className="tk-column-body">
                {tasks.length === 0 ? <p className="tk-empty">{col.value === "done" ? "Nothing done in the last 30 days." : "Nothing here."}</p> : tasks.map((t) => <TaskCard key={t.id} task={t} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
