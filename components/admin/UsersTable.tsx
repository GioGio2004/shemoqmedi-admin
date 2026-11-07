"use client";

import { showError } from "./Alerts";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/storefront";

type User = FunctionReturnType<typeof api.admin.listUsers>[number];
type Role = User["role"];

const ROLES: { value: Role; label: string }[] = [
  { value: null, label: "None" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super admin" },
];

function roleLabel(role: Role) {
  return ROLES.find((r) => r.value === role)?.label ?? "None";
}

/** Super admin filled black, admin outlined black, none muted. */
const ROLE_BADGE: Record<NonNullable<Role> | "none", string> = {
  super_admin: "awarded",
  admin: "archived",
  none: "rejected",
};

function UserRow({ user }: { user: User }) {
  const setRole = useMutation(api.admin.setUserRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(role: Role) {
    if (busy || user.isYou || role === user.role) return;
    if (role === "super_admin" || user.role === "super_admin") {
      const message =
        role === "super_admin"
          ? `Make ${user.name} a super admin? Super admins can grant and remove every role, including yours.`
          : `Remove super admin from ${user.name}? They will become ${role === null ? "a regular user" : "an admin"}.`;
      if (!confirm(message)) return;
    } else if (role === null) {
      if (!confirm(`Remove admin access from ${user.name}?`)) return;
    }
    setBusy(true);
    setError(null);
    try {
      await setRole({ userId: user.id, role });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="claim-card">
      <div className="claim-card-main">
        <div className="min-w-0">
          <p className="admin-eyebrow">
            Joined {formatDate(user.createdAt)}
          </p>
          <h2>
            {user.name || "Unnamed user"}
            {user.isYou && (
              <span className="admin-tag ml-3 align-middle" aria-label="This is you">
                You
              </span>
            )}
          </h2>
          <p className="claim-meta">
            <a href={`mailto:${user.email}`} className="underline underline-offset-4">
              {user.email}
            </a>
          </p>
        </div>
        <span className="admin-status" data-status={ROLE_BADGE[user.role ?? "none"]}>
          <span className="admin-status-dot" aria-hidden="true" />
          {user.role ? roleLabel(user.role) : "User"}
        </span>
      </div>

      <dl className="request-fields">
        <div>
          <dt>Listings</dt>
          <dd className="admin-mono admin-score">{user.listings}</dd>
        </div>
        <div>
          <dt>Votes</dt>
          <dd className="admin-mono admin-score">{user.votes}</dd>
        </div>
      </dl>

      <div className="claim-actions">
        <fieldset className="grid gap-2" disabled={busy || user.isYou}>
          <legend className="admin-eyebrow mb-2">Role</legend>
          <div className="flex flex-wrap items-center gap-2">
            {ROLES.map((r) => (
              <button
                key={r.label}
                type="button"
                className="admin-toggle"
                aria-pressed={user.role === r.value}
                onClick={() => onChange(r.value)}
              >
                {r.label}
              </button>
            ))}
            {busy && <span className="text-xs text-black/55">Saving…</span>}
            {user.isYou && (
              <span className="text-xs text-black/55">You can’t change your own role.</span>
            )}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm font-medium">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

export function UsersTable() {
  const users = useQuery(api.admin.listUsers, {});
  const [search, setSearch] = useState("");

  const needle = search.trim().toLowerCase();
  const rows = users?.filter(
    (u) => !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle),
  );
  const admins = users?.filter((u) => u.role !== null).length;

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Users</p>
          <h1>Users.</h1>
          <p>
            Everyone who has signed up, newest first. Admins can use this panel; only a super admin
            can grant or remove super admin.
          </p>
        </div>
        <label className="grid w-full max-w-[320px] gap-2">
          <span className="admin-eyebrow">Search name or email</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-input"
            placeholder="name@example.com"
          />
        </label>
      </div>

      {rows === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          <h2>{needle ? "No match." : "No users yet."}</h2>
          {needle
            ? `No name or email contains “${search.trim()}”.`
            : "Users appear here after they sign up on the site."}
        </div>
      ) : (
        <>
          <p className="admin-eyebrow mb-4" role="status">
            {rows.length} {rows.length === 1 ? "user" : "users"}
            {needle && users ? ` of ${users.length}` : ""} · {admins} with admin access
          </p>
          <ul className="request-list">
            {rows.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
