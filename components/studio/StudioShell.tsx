"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAdmin, type AdminState } from "@/components/admin/useAdmin";
import { usePush, type Push } from "@/components/pwa/usePush";
import { ADMIN_APP_ORIGIN } from "@/lib/hosts";
import { ArrowIcon, BellIcon, GearIcon, HomeIcon, PlusIcon, QueueIcon, ReelIcon } from "./icons";
import { Skel } from "./ui";
import { SettingsSheet } from "./SettingsSheet";

// The Studio's frame: top bar, the bottom tab bar, the settings sheet and
// the admin gate. Pages render only for platform admins; a signed-out
// visitor goes to sign-in and comes back to the same address.

const PushContext = createContext<Push | null>(null);

/** This device's push switch (one usePush for the whole app: it re-saves the subscription on mount). */
export function useStudioPush() {
  return useContext(PushContext);
}

/** Runs usePush (admins only) and hands its state up, so the frame never remounts when the gate opens. */
function PushProbe({ onChange }: { onChange: (push: Push) => void }) {
  const { state, endpoint, busy, enable, disable } = usePush();
  const push = useMemo(() => ({ state, endpoint, busy, enable, disable }), [state, endpoint, busy, enable, disable]);
  useEffect(() => onChange(push), [push, onChange]);
  return null;
}

/** The Studio's addresses have no /studio prefix; strip it should a server render report the rewritten path. */
function studioPath(pathname: string | null) {
  const p = (pathname ?? "/").replace(/^\/studio(?=\/|$)/, "") || "/";
  return p;
}

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/queue", label: "Queue", Icon: QueueIcon },
  { href: "/create", label: "Create", Icon: PlusIcon },
  { href: "/reels", label: "Reels", Icon: ReelIcon },
  { href: "/reminders", label: "Reminders", Icon: BellIcon },
] as const;

function isCurrent(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

function WaitingCount() {
  const n = useQuery(api.social.waitingCount, {});
  if (!n) return null;
  return (
    <span className="st-tab-count" aria-label={`${n} waiting`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function TabBar({ path, admin }: { path: string; admin: boolean }) {
  return (
    <nav className="st-tabbar" aria-label="Studio">
      {TABS.map(({ href, label, Icon }) => {
        const current = isCurrent(path, href) ? "page" : undefined;
        if (href === "/create") {
          return (
            <Link key={href} href={href} className="st-tab st-tab-create" aria-current={current}>
              <span className="st-create-btn">
                <Icon size={22} />
              </span>
              {label}
            </Link>
          );
        }
        return (
          <Link key={href} href={href} className="st-tab" aria-current={current}>
            <Icon />
            {label}
            {href === "/queue" && admin && <WaitingCount />}
          </Link>
        );
      })}
    </nav>
  );
}

const noSubscribe = () => () => {};

/** The admin app's address from here: localhost next to studio.localhost, else production. */
function adminOrigin() {
  const { hostname, port, protocol } = window.location;
  return hostname === "studio.localhost" ? `${protocol}//localhost${port ? `:${port}` : ""}` : ADMIN_APP_ORIGIN;
}

/** Signed out of Clerk (the session ended while the app was open): to sign-in, then back here. */
function useSignedOutRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    const back = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
  }, [isLoaded, isSignedIn]);
}

export function StudioShell({ children }: { children: ReactNode }) {
  const path = studioPath(usePathname());
  const admin = useAdmin();
  const [settings, setSettings] = useState(false);
  const admins = useSyncExternalStore(noSubscribe, adminOrigin, () => ADMIN_APP_ORIGIN);
  useSignedOutRedirect();
  const isAdmin = admin.kind === "admin";
  const [push, setPush] = useState<Push | null>(null);

  return (
    <PushContext.Provider value={isAdmin ? push : null}>
      <div className="st">
        <header className="st-top">
          <div className="st-top-in">
            <Link href="/" className="st-brand" aria-label="Studio home">
              <span className="st-brand-mark" aria-hidden="true" />
              Studio
              <small>Shemoqmedi</small>
            </Link>
            <div className="st-top-actions">
              <a className="st-top-link" href={`${admins}/dashboard`} target="_blank" rel="noopener noreferrer">
                Admin <ArrowIcon size={14} />
              </a>
              <button type="button" className="st-icon-btn" aria-label="Settings" onClick={() => setSettings(true)} disabled={!isAdmin}>
                <GearIcon />
              </button>
            </div>
          </div>
        </header>
        <main className="st-main">{isAdmin ? children : admin.kind === "loading" ? <ShellSkeleton /> : <AccessNotice state={admin} />}</main>
        <TabBar path={path} admin={isAdmin} />
        {isAdmin && <SettingsSheet open={settings} onClose={() => setSettings(false)} adminOrigin={admins} />}
        {isAdmin && <PushProbe onChange={setPush} />}
      </div>
    </PushContext.Provider>
  );
}

function ShellSkeleton() {
  return (
    <div className="st-stack-lg" aria-busy="true" aria-label="Loading">
      <div className="st-head">
        <Skel className="st-skel-text" style={{ width: 120 }} />
        <Skel style={{ height: 72, width: "62%" }} />
      </div>
      <div className="st-bento">
        <Skel className="st-span-2" style={{ height: 160, borderRadius: 14 }} />
        <Skel style={{ height: 132, borderRadius: 14 }} />
        <Skel style={{ height: 132, borderRadius: 14 }} />
      </div>
    </div>
  );
}

function AccessNotice({ state }: { state: Exclude<AdminState, { kind: "admin" | "loading" }> }) {
  const copy =
    state.kind === "no-session"
      ? { title: "Session not accepted.", body: "You're signed in, but the database did not accept the session. Sign out and in again; if it persists, check the Clerk JWT template \"convex\"." }
      : state.kind === "not-synced"
        ? { title: "Almost there.", body: "Your account hasn't reached the database yet. Refresh in a moment." }
        : { title: "No access.", body: `The Studio is for platform admins, and ${state.email} isn't one.` };
  return (
    <div className="st-stack-lg st-in">
      <header className="st-head">
        <p className="st-eyebrow">
          <b>00</b> Studio
        </p>
        <h1 className="st-h1">{copy.title}</h1>
      </header>
      <p className="st-lede">{copy.body}</p>
    </div>
  );
}
