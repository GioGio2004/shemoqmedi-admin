"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAdmin, type AdminState } from "@/components/admin/useAdmin";
import { usePush, type Push } from "@/components/pwa/usePush";
import { ADMIN_APP_ORIGIN } from "@/lib/hosts";
import { AmbientProvider } from "./Ambient";
import { PortalContext, TitleContext } from "./chrome";
import { Droplet } from "./Droplet";
import { useMedia } from "./hooks";
import { ArrowIcon, BellIcon, GearIcon, HomeIcon, MoonIcon, PlusIcon, QueueIcon, ReelIcon, SunIcon } from "./icons";
import { useLiquid } from "./liquid";
import { SettingsSheet } from "./SettingsSheet";
import { setThemePref, syncThemeChrome, useTheme } from "./theme";
import { StudioToasts } from "./Toasts";
import { Skel } from "./ui";

// The Studio's frame: the glass top bar (the page's large title collapses into
// it), the floating tab bar (a left dock on wide screens), the ambient
// background, the settings sheet, the toasts and the admin gate. Pages render
// only for platform admins; a signed-out visitor goes to sign-in and comes
// back to the same address.

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
    <span className="st-tab-count">
      <span aria-hidden="true">{n > 99 ? "99+" : n}</span>
      <span className="sr-only">, {n} waiting</span>
    </span>
  );
}

/** The floating capsule (phones) or left dock (900px and up), with the droplet on the current page. */
function TabBar({ path, admin, barRef }: { path: string; admin: boolean; barRef: React.RefObject<HTMLElement | null> }) {
  const desk = useMedia("(min-width: 900px)");
  return (
    <nav ref={barRef} className="st-tabbar" aria-label="Studio">
      <Droplet track={barRef} active={path} axis={desk ? "y" : "x"} className="st-tab-drop" />
      <Link href="/" className="st-dock-mark" aria-label="Studio home" tabIndex={desk ? 0 : -1}>
        <span className="st-crow" aria-hidden="true" />
      </Link>
      {TABS.map(({ href, label, Icon }) => {
        const current = isCurrent(path, href) ? "page" : undefined;
        if (href === "/create") {
          return (
            <Link key={href} href={href} className="st-tab-create" aria-current={current} aria-label={label} data-drop-skip="">
              <Icon size={24} />
            </Link>
          );
        }
        return (
          <Link key={href} href={href} className="st-tab" aria-current={current}>
            <Icon size={24} />
            <span className="st-tab-label">{label}</span>
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

/**
 * Scrolling: the top bar's glass and small title fade in as the large title
 * passes under it, the large title stretches on overscroll, and the tab bar
 * compacts while scrolling down (phones). Written straight to the elements.
 */
function useScrollChrome(glass: React.RefObject<HTMLElement | null>, small: React.RefObject<HTMLElement | null>, bar: React.RefObject<HTMLElement | null>, path: string) {
  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const run = () => {
      raf = 0;
      const y = window.scrollY;
      glass.current?.style.setProperty("opacity", Math.min(1, Math.max(0, y / 36)).toFixed(3));
      const large = document.querySelector<HTMLElement>(".st-main [data-large-title]");
      // The small title appears once the large one has gone under the bar.
      const gone = large ? Math.min(1, Math.max(0, (y - (large.offsetTop + large.offsetHeight - 70)) / 18)) : Math.min(1, Math.max(0, (y - 34) / 18));
      small.current?.style.setProperty("opacity", gone.toFixed(3));
      small.current?.style.setProperty("transform", `translate3d(0,${((1 - gone) * 6).toFixed(2)}px,0)`);
      large?.style.setProperty("transform", y < 0 ? `scale(${(1 + Math.min(0.12, -y / 600)).toFixed(4)})` : "");
      const b = bar.current;
      if (b) {
        const desk = window.matchMedia("(min-width: 900px)").matches;
        if (desk || y < 60 || y < last - 6) b.classList.remove("is-compact");
        else if (y > last + 6 && y > 120) b.classList.add("is-compact");
      }
      if (Math.abs(y - last) > 6) last = y;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    run();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [glass, small, bar, path]);
}

function ThemeButton() {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="st-icon-btn"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setThemePref(dark ? "light" : "dark", { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export function StudioShell({ children }: { children: ReactNode }) {
  const path = studioPath(usePathname());
  const admin = useAdmin();
  const [settings, setSettings] = useState(false);
  const admins = useSyncExternalStore(noSubscribe, adminOrigin, () => ADMIN_APP_ORIGIN);
  useSignedOutRedirect();
  const isAdmin = admin.kind === "admin";
  const [push, setPush] = useState<Push | null>(null);
  const [title, setTitle] = useState("");
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const small = useRef<HTMLParagraphElement>(null);
  const bar = useRef<HTMLElement>(null);
  useLiquid(root);
  useScrollChrome(glass, small, bar, path);
  useEffect(() => syncThemeChrome(), []);

  return (
    <PushContext.Provider value={isAdmin ? push : null}>
      <TitleContext.Provider value={setTitle}>
        <PortalContext.Provider value={portal}>
          <div className="st" ref={root}>
            <AmbientProvider>
              <header className="st-top">
                <div ref={glass} className="st-top-glass" aria-hidden="true" />
                <div className="st-top-in">
                  <Link href="/" className="st-brand" aria-label="Studio home">
                    <span className="st-crow" aria-hidden="true" />
                    <span>Studio</span>
                  </Link>
                  <p ref={small} className="st-top-title" aria-hidden="true">
                    {title}
                  </p>
                  <div className="st-top-actions">
                    <a className="st-icon-btn st-top-link" href={`${admins}/dashboard`} target="_blank" rel="noopener noreferrer" aria-label="Admin, opens in a new tab">
                      <ArrowIcon />
                    </a>
                    <ThemeButton />
                    <button type="button" className="st-icon-btn" aria-label="Settings" onClick={() => setSettings(true)} disabled={!isAdmin}>
                      <GearIcon />
                    </button>
                  </div>
                </div>
              </header>
              <main className="st-main">{isAdmin ? children : admin.kind === "loading" ? <ShellSkeleton /> : <AccessNotice state={admin} />}</main>
              <TabBar path={path} admin={isAdmin} barRef={bar} />
              {isAdmin && <SettingsSheet open={settings} onClose={() => setSettings(false)} adminOrigin={admins} />}
              {isAdmin && <PushProbe onChange={setPush} />}
              <StudioToasts />
              <div ref={setPortal} className="st-portal" />
            </AmbientProvider>
          </div>
        </PortalContext.Provider>
      </TitleContext.Provider>
    </PushContext.Provider>
  );
}

function ShellSkeleton() {
  return (
    <div className="st-stack-lg" aria-busy="true" aria-label="Loading">
      <div className="st-head">
        <Skel className="st-skel-text" style={{ width: 120 }} />
        <Skel className="st-skel-title" />
      </div>
      <div className="st-bento">
        <Skel className="st-span-2" style={{ height: 180, borderRadius: 28 }} />
        <Skel style={{ height: 132, borderRadius: 28 }} />
        <Skel style={{ height: 132, borderRadius: 28 }} />
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
        <p className="st-eyebrow">Studio</p>
        <h1 className="st-h1" data-large-title="">
          {copy.title}
        </h1>
      </header>
      <p className="st-lede">{copy.body}</p>
    </div>
  );
}
