// The Studio's theme, shared by the server layout (the pre-paint script) and
// the client (components/studio/theme.ts). Kept free of "use client" so the
// layout imports the real strings, not client references.

export const THEME_KEY = "studio-theme";
export const THEME_ATTR = "data-studio-theme";
export const THEME_BG = { light: "#f4f4f2", dark: "#09090a" } as const;

/** Runs before the Studio paints: an explicit Light or Dark choice goes on <html>, System leaves it off. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="dark"||t==="light")document.documentElement.setAttribute(${JSON.stringify(THEME_ATTR)},t)}catch(e){}`;
