"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Select } from "@/components/admin/Select";
import { showError } from "@/components/admin/Alerts";
import { TaskBoard } from "./TaskBoard";
import { MEMBER_ROLES, TASK_PRIORITIES, newItemId, roleLabel, type MemberRole, type TaskPriority } from "./taskLabels";

// The admin's Tasks page: the board, "New task" and the team list.

function NewTask({ presetGuide, onClose }: { presetGuide?: string; onClose: () => void }) {
  const create = useMutation(api.tasks.create);
  const members = useQuery(api.tasks.members, {});
  const guides = useQuery(api.guides.list, {});
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignees, setAssignees] = useState<Id<"teamMembers">[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [due, setDue] = useState("");
  const [guide, setGuide] = useState<string | null>(null);
  const [checklist, setChecklist] = useState("");
  const [busy, setBusy] = useState(false);

  // A guide passed in the address (?guide=<slug>) is picked until the owner changes it.
  const guideId = guide ?? guides?.find((g) => g.slug === presetGuide)?.id ?? "";
  const guideTitle = guides?.find((g) => g.id === guideId)?.title;

  return (
    <form
      className="admin-panel grid gap-5"
      aria-label="New task"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const n = await create({
            title,
            description,
            assigneeIds: assignees,
            priority,
            dueDate: due || undefined,
            guideId: guideId ? (guideId as Id<"guides">) : undefined,
            checklist: checklist
              .split("\n")
              .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
              .filter(Boolean)
              .map((text) => ({ id: newItemId(), text, done: false })),
          });
          router.push(`/tasks/${n}`);
        } catch (err) {
          showError(err);
          setBusy(false);
        }
      }}
    >
      <p className="admin-eyebrow">New task</p>
      <label className="grid gap-2">
        <span className="admin-eyebrow">Title</span>
        <input
          className="admin-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={guideTitle ? `For example: ${guideTitle}, 10 today` : "Invite 10 Product Hunt makers"}
          maxLength={160}
          required
          autoFocus
        />
      </label>
      <div className="grid gap-2">
        <span id={`${id}-who`} className="admin-eyebrow">
          Assign to
        </span>
        <div role="group" aria-labelledby={`${id}-who`} className="flex flex-wrap gap-2">
          {(members ?? [])
            .filter((m) => m.active)
            .map((m) => {
              const on = assignees.includes(m.id);
              return (
                <button key={m.id} type="button" className="admin-toggle" aria-pressed={on} onClick={() => setAssignees(on ? assignees.filter((x) => x !== m.id) : [...assignees, m.id])}>
                  {m.name}
                </button>
              );
            })}
          {members?.filter((m) => m.active).length === 0 && <span className="text-sm opacity-60">Add people under Team first (below the board).</span>}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="grid gap-2">
          <span id={`${id}-priority`} className="admin-eyebrow">
            Priority
          </span>
          <Select value={priority} onChange={(v) => setPriority(v as TaskPriority)} options={TASK_PRIORITIES} labelledBy={`${id}-priority`} />
        </div>
        <label className="grid gap-2">
          <span className="admin-eyebrow">Due (optional)</span>
          <input type="date" className="admin-input" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <div className="grid gap-2">
          <span id={`${id}-guide`} className="admin-eyebrow">
            Guide to follow
          </span>
          <Select
            value={guideId}
            onChange={setGuide}
            options={[{ value: "", label: "None" }, ...(guides ?? []).map((g) => ({ value: g.id, label: g.title }))]}
            labelledBy={`${id}-guide`}
          />
        </div>
      </div>
      <label className="grid gap-2">
        <span className="admin-eyebrow">What to do (optional)</span>
        <textarea className="admin-input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} />
      </label>
      <label className="grid gap-2">
        <span className="admin-eyebrow">Checklist (optional, one item per line)</span>
        <textarea className="admin-input" rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={"Find 10 sites\nLog them on the Listings tab\nSend the invitation"} />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="admin-button" disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create task"}
        </button>
        <button type="button" className="admin-button admin-button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MemberRow({ member }: { member: FunctionReturnType<typeof api.tasks.members>[number] }) {
  const update = useMutation(api.tasks.updateMember);
  const remove = useMutation(api.tasks.removeMember);
  const [email, setEmail] = useState(member.email ?? "");
  const id = useId();
  return (
    <li className="tk-member">
      <div className="grid min-w-0 gap-1">
        <p className="font-medium">
          {member.name} {!member.active && <span className="admin-tag">Away</span>}
        </p>
        <p className="text-xs opacity-60">
          {roleLabel(member.role)} · {member.openTasks} open task{member.openTasks === 1 ? "" : "s"}
        </p>
      </div>
      <div className="tk-member-fields">
        <div className="w-44">
          <span id={`${id}-role`} className="sr-only">
            Role of {member.name}
          </span>
          <Select value={member.role} onChange={(v) => update({ memberId: member.id, role: v as MemberRole }).catch(showError)} options={MEMBER_ROLES} labelledBy={`${id}-role`} />
        </div>
        <input
          className="admin-input tk-member-email"
          type="email"
          value={email}
          placeholder="Account email (for My tasks)"
          aria-label={`Account email of ${member.name}`}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => email.trim().toLowerCase() !== (member.email ?? "") && update({ memberId: member.id, email }).catch((err) => (showError(err), setEmail(member.email ?? "")))}
        />
        <button type="button" className="admin-toggle" onClick={() => update({ memberId: member.id, active: !member.active }).catch(showError)}>
          {member.active ? "Mark away" : "Back"}
        </button>
        <button
          type="button"
          className="admin-toggle"
          onClick={() => confirm(`Remove ${member.name} from the team? They are taken off their tasks.`) && remove({ memberId: member.id }).catch(showError)}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function Team() {
  const members = useQuery(api.tasks.members, {});
  const add = useMutation(api.tasks.addMember);
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("ops");
  const [email, setEmail] = useState("");
  const id = useId();
  return (
    <section className="admin-panel grid gap-5" aria-labelledby={`${id}-h`}>
      <div className="grid gap-1">
        <p id={`${id}-h`} className="admin-eyebrow">
          Team
        </p>
        <p className="text-sm opacity-60">
          The people you assign tasks to. The account email is the one they sign in to the docs with: it shows them their own tasks there.
        </p>
      </div>
      {members && members.length > 0 && (
        <ul className="grid">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </ul>
      )}
      <form
        className="tk-member-add"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await add({ name, role, email: email || undefined });
            setName("");
            setEmail("");
          } catch (err) {
            showError(err);
          }
        }}
      >
        <input className="admin-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" maxLength={80} required />
        <div className="w-44">
          <span id={`${id}-role`} className="sr-only">
            Role
          </span>
          <Select value={role} onChange={(v) => setRole(v as MemberRole)} options={MEMBER_ROLES} labelledBy={`${id}-role`} />
        </div>
        <input className="admin-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Account email (optional)" aria-label="Account email" />
        <button type="submit" className="admin-button" disabled={!name.trim()}>
          Add to team
        </button>
      </form>
    </section>
  );
}

/** /tasks in the admin. `presetGuide` (from ?guide=) opens New task with that guide picked. */
export function TaskAdmin({ presetGuide }: { presetGuide?: string }) {
  const [creating, setCreating] = useState(!!presetGuide);
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Team</p>
          <h1>Tasks.</h1>
          <p>
            Assign work to the team. Each task can point at the guide that explains it, and has a checklist and comments. The team
            sees theirs on the docs under Tasks, where they move them along.
          </p>
        </div>
        {!creating && (
          <button type="button" className="admin-button" onClick={() => setCreating(true)}>
            New task
          </button>
        )}
      </div>
      <div className="grid gap-8">
        {creating && <NewTask presetGuide={presetGuide} onClose={() => setCreating(false)} />}
        <TaskBoard mode="admin" />
        <Team />
      </div>
    </>
  );
}
