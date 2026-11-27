// The admin's light / dark theme. Dark is the team docs' look: charcoal
// #1c1c1c with a pale grain, white type, orange #ff4d00 as the one accent
// (app/globals.css, html[data-admin-theme="dark"]).
//
// The choice lives in this device's localStorage ("admin-theme": "light",
// "dark", or nothing = follow the system). ADMIN_THEME_SCRIPT runs in <head>
// before the first paint, so there is no flash of the other theme. It only
// acts on the admin's host: the Studio has its own theme (data-studio-theme)
// and the docs are always dark.

export const ADMIN_THEME_KEY = "admin-theme";
export const ADMIN_THEME_ATTR = "data-admin-theme";
export const ADMIN_THEME_BG = { light: "#ffffff", dark: "#1c1c1c" } as const;

export type AdminThemePref = "system" | "light" | "dark";

/** Hosts that are not the admin (the same app serves them): the script leaves them alone. */
const OTHER_HOSTS = /^(studio|docs)\./;

export const ADMIN_THEME_SCRIPT = `try{(function(){if(${OTHER_HOSTS}.test(location.hostname))return;var d=document.documentElement,q=matchMedia("(prefers-color-scheme: dark)");function s(){var p=null;try{p=localStorage.getItem("${ADMIN_THEME_KEY}")}catch(e){}var k=p==="dark"||(p!=="light"&&q.matches);if(k)d.setAttribute("${ADMIN_THEME_ATTR}","dark");else d.removeAttribute("${ADMIN_THEME_ATTR}");var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=k?"${ADMIN_THEME_BG.dark}":"${ADMIN_THEME_BG.light}"}s();q.addEventListener("change",s);window.__applyAdminTheme=s})()}catch(e){}`;
