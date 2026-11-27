"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { GuideText } from "@/components/guides/GuideText";
import { Select } from "@/components/admin/Select";
import { showError } from "@/components/admin/Alerts";
import { TASK_PRIORITIES, TASK_STATUSES, dueLabel, isOverdue, newItemId, priorityLabel, statusLabel, taskKey, type TaskPriority, type TaskStatus } from "./taskLabels";

// One task, shared by the admin and the docs. On the docs (`mode` "docs")
// the team moves the status, ticks the checklist and comments; everything
// else is the owner's, in the admin (`mode` "admin").

type Task = NonNullable<FunctionReturnType<typeof api.tasks.get>>;

function when(ms: number) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tbilisi" }).format(ms);
}

function Checklist({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const toggle = useMutation(api.tasks.toggleItem);
  const update = useMutation(api.tasks.update);
  const [draft, setDraft] = useState("");
  const items = task.checklist;
  const save = (checklist: Task["checklist"]) => update({ taskId: task.card.id, checklist }).catch(showError);
  if (!items.length && !canEdit) return null;
  return (
    <section className="tk-block" aria-label="Checklist">
      <p className="tk-label">
        Checklist {items.length > 0 && `· ${items.filter((i) => i.done).length}/${items.length}`}
      </p>
      <ul className="tk-checklist">
        {items.map((item) => (
          <li key={item.id}>
            <label className="admin-check">
              <input type="checkbox" checked={item.done} onChange={(e) => toggle({ taskId: task.card.id, itemId: item.id, done: e.target.checked }).catch(showError)} />
              <span data-done={item.done || undefined}>{item.text}</span>
            </label>
            {canEdit && (
              <button type="button" className="tk-x" aria-label={`Remove “${item.text}”`} onClick={() => save(items.filter((i) => i.id !== item.id))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            void save([...items, { id: newItemId(), text: draft, done: false }]);
            setDraft("");
          }}
        >
          <input className="admin-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a checklist item" maxLength={240} aria-label="New checklist item" />
          <button type="submit" className="admin-button admin-button-secondary" disabled={!draft.trim()}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}

function Comments({ task }: { task: Task }) {
  const add = useMutation(api.tasks.addComment);
  const remove = useMutation(api.tasks.removeComment);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="tk-block" aria-label="Comments">
      <p className="tk-label">Comments</p>
      {task.comments.length > 0 && (
        <ul className="tk-comments">
          {task.comments.map((c) => (
            <li key={c.id}>
              <p className="tk-comment-head">
                <strong>{c.author}</strong> <span>{when(c.createdAt)}</span>
                {c.mine && (
                  <button type="button" className="tk-x" aria-label="Delete this comment" onClick={() => confirm("Delete this comment?") && remove({ commentId: c.id }).catch(showError)}>
                    ×
                  </button>
                )}
              </p>
              <p className="tk-comment-body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await add({ taskId: task.card.id, body });
            setBody("");
          } catch (err) {
            showError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea className="admin-input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="A question, an update, a link…" maxLength={4000} aria-label="New comment" />
        <div>
          <button type="submit" className="admin-button" disabled={busy || !body.trim()}>
            {busy ? "Sending…" : "Comment"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Description({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const update = useMutation(api.tasks.update);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.card.title);
  const [text, setText] = useState(task.description);
  if (editing)
    return (
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await update({ taskId: task.card.id, title, description: text });
            setEditing(false);
          } catch (err) {
            showError(err);
          }
        }}
      >
        <label className="grid gap-2">
          <span className="tk-label">Title</span>
          <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        </label>
        <label className="grid gap-2">
          <span className="tk-label">What to do</span>
          <textarea className="admin-input guide-textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} />
          <span className="text-xs opacity-60">A blank line starts a paragraph; “- ” makes a bullet, “1. ” a step. Links work as typed.</span>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="admin-button" disabled={!title.trim()}>
            Save
          </button>
          <button type="button" className="admin-button admin-button-secondary" onClick={() => (setEditing(false), setTitle(task.card.title), setText(task.description))}>
            Cancel
          </button>
        </div>
      </form>
    );
  return (
    <section className="tk-block" aria-label="Description">
      {task.description ? <GuideText text={task.description} className="guide-text" /> : <p className="opacity-50">{canEdit ? "No description yet." : "No description."}</p>}
      {canEdit && (
        <div>
          <button type="button" className="admin-text-link" onClick={() => setEditing(true)}>
            Edit title and description
          </button>
        </div>
      )}
    </section>
  );
}

function Details({ task, mode }: { task: Task; mode: "admin" | "docs" }) {
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const members = useQuery(api.tasks.members, mode === "admin" ? {} : "skip");
  const guides = useQuery(api.guides.list, mode === "admin" ? {} : "skip");
  const router = useRouter();
  const id = useId();
  const canEdit = mode === "admin";
  const set = (patch: Omit<Parameters<typeof update>[0], "taskId">) => update({ taskId: task.card.id, ...patch }).catch(showError);
  const overdue = isOverdue(task.card.dueDate, task.card.status);

  return (
    <aside className="tk-details">
      <div className="grid gap-2">
        <span id={`${id}-status`} className="tk-label">
          Status
        </span>
        <Select value={task.card.status} onChange={(v) => set({ status: v as TaskStatus })} options={TASK_STATUSES} labelledBy={`${id}-status`} />
      </div>

      <div className="grid gap-2">
        <span id={`${id}-priority`} className="tk-label">
          Priority
        </span>
        {canEdit ? (
          <Select value={task.card.priority} onChange={(v) => set({ priority: v as TaskPriority })} options={TASK_PRIORITIES} labelledBy={`${id}-priority`} />
        ) : (
          <p>{priorityLabel(task.card.priority)}</p>
        )}
      </div>

      <div className="grid gap-2">
        <span id={`${id}-who`} className="tk-label">
          Assigned to
        </span>
        {canEdit ? (
          <div role="group" aria-labelledby={`${id}-who`} className="flex flex-wrap gap-2">
            {(members ?? [])
              .filter((m) => m.active || task.assigneeIds.includes(m.id))
              .map((m) => {
                const on = task.assigneeIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="admin-toggle"
                    aria-pressed={on}
                    onClick={() => set({ assigneeIds: on ? task.assigneeIds.filter((x) => x !== m.id) : [...task.assigneeIds, m.id] })}
                  >
                    {m.name}
                  </button>
                );
              })}
            {members?.length === 0 && <p className="text-sm opacity-60">Add people under Team on the Tasks page.</p>}
          </div>
        ) : (
          <p>{task.card.assignees.map((a) => a.name).join(", ") || "Nobody yet"}</p>
        )}
      </div>

      <div className="grid gap-2">
        <label htmlFor={`${id}-due`} className="tk-label">
          Due
        </label>
        {canEdit ? (
          <input id={`${id}-due`} type="date" className="admin-input" value={task.card.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value })} />
        ) : (
          <p data-overdue={overdue || undefined} className="tk-due">
            {task.card.dueDate ? `${overdue ? "Overdue · " : ""}${dueLabel(task.card.dueDate)}` : "No date"}
          </p>
        )}
      </div>

      {canEdit && (
        <div className="grid gap-2">
          <span id={`${id}-guide`} className="tk-label">
            Guide to follow
          </span>
          <Select
            value={guides?.find((g) => g.slug === task.card.guide?.slug)?.id ?? ""}
            onChange={(v) => set({ guideId: v ? (v as Id<"guides">) : null })}
            options={[{ value: "", label: "None" }, ...(guides ?? []).map((g) => ({ value: g.id, label: g.title }))]}
            labelledBy={`${id}-guide`}
          />
        </div>
      )}

      <p className="text-xs opacity-60">
        Created {when(task.createdAt)}
        {task.createdByName ? ` by ${task.createdByName}` : ""}
        {task.card.completedAt ? ` · done ${when(task.card.completedAt)}` : ""}
      </p>

      {canEdit && (
        <button
          type="button"
          className="admin-text-link"
          onClick={async () => {
            if (!confirm(`Delete ${taskKey(task.card.number)} “${task.card.title}” and its comments? This can't be undone.`)) return;
            try {
              await remove({ taskId: task.card.id });
              router.push("/tasks");
            } catch (err) {
              showError(err);
            }
          }}
        >
          Delete task
        </button>
      )}
    </aside>
  );
}

/** One task page: the key, title and status, what to do, the guide, the checklist, comments and the details. */
export function TaskDetail({ number, mode }: { number: number; mode: "admin" | "docs" }) {
  const task = useQuery(api.tasks.get, Number.isInteger(number) && number > 0 ? { number } : "skip");
  if (!Number.isInteger(number) || number <= 0 || task === null)
    return (
      <div className="tk-scope admin-empty">
        No task {Number.isInteger(number) ? taskKey(number) : "here"}. It may have been deleted. <Link href="/tasks">All tasks</Link>
      </div>
    );
  if (task === undefined) return <p className="admin-eyebrow">Loading…</p>;
  const canEdit = mode === "admin";
  const guideHref = task.card.guide && (mode === "admin" || task.card.guide.ready) ? `/guides/${task.card.guide.slug}` : null;

  return (
    <div className="tk-scope grid gap-8">
      <header className="tk-head">
        <p className="tk-head-kicker">
          <Link href="/tasks">Tasks</Link> <span aria-hidden="true">/</span> <span className="tk-key">{taskKey(task.card.number)}</span>
          <span className="tk-status" data-status={task.card.status}>
            {statusLabel(task.card.status)}
          </span>
        </p>
        <h1>{task.card.title}</h1>
      </header>

      <div className="tk-layout">
        <div className="grid min-w-0 gap-8">
          <Description key={`${task.card.title}\n${task.description}`} task={task} canEdit={canEdit} />
          {task.card.guide && (
            <section className="tk-guide">
              <p className="tk-label">Follow this guide</p>
              {guideHref ? (
                <Link href={guideHref} className="tk-guide-link">
                  {task.card.guide.title} <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <p>{task.card.guide.title} (not published to the docs yet)</p>
              )}
            </section>
          )}
          <Checklist task={task} canEdit={canEdit} />
          <Comments task={task} />
        </div>
        <Details task={task} mode={mode} />
      </div>
    </div>
  );
}
