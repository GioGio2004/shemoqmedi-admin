// The Studio and admin UX fixes that have no server side: work kept across
// navigation (Create, queue captions, the reel build), Chrome's install offer
// caught at page load, the glass palette strip's requests, the Settings
// sheet's messages, tap targets, the pinned preview while typing, the admin
// "More" sheet's backdrop, and the Studio's own 404 for unknown paths.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAFT_TTL_MS, createDraftStore, readDraft, writeDraft, type DraftStorage } from "../lib/studio/persist";
import { createReelBuilds, type BuiltReel } from "../lib/studio/reelBuild";
import { staleCaptionDraft } from "../lib/studio/queue";
import { createInstallStore, type InstallEvent } from "../components/pwa/installEvent";
import { assetsUrl, miniFetchesAssets, previewShotUrl } from "../lib/studio/create";
import { storyVideoProblem } from "../convex/lib/socialApi";
import StudioUnknownPage from "../app/studio/[...rest]/page";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** A localStorage stand-in. */
function memoryStorage() {
  const map = new Map<string, string>();
  const store: DraftStorage & { map: Map<string, string> } = {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return store;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("drafts kept on this device", () => {
  it("reads back what was written, forgets it after the TTL, and never throws", () => {
    const store = memoryStorage();
    writeDraft("create:single", { title: "Floema" }, store, 1000);
    expect(readDraft("create:single", store, 2000)).toEqual({ title: "Floema" });
    expect(readDraft("create:single", store, 1000 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(store.map.size).toBe(0); // the expired draft is removed
    writeDraft("x", { a: 1 }, store);
    writeDraft("x", null, store);
    expect(readDraft("x", store)).toBeNull();

    // Blocked or full storage: the page still works, it just keeps nothing.
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => writeDraft("y", { a: 1 }, broken)).not.toThrow();
    expect(readDraft("y", broken)).toBeNull();
    expect(readDraft("z", null)).toBeNull();
    store.setItem("studio:bad", "{not json");
    expect(readDraft("bad", store)).toBeNull();
  });

  it("a draft store hands the same draft to a card that remounts, and to the next page load", () => {
    const storage = memoryStorage();
    const drafts = createDraftStore<{ instagram: string }>("captions", () => storage);
    const seen: number[] = [];
    const off = drafts.subscribe(() => seen.push(1));
    expect(drafts.get("post1")).toBeNull();
    drafts.set("post1", { instagram: "Rewritten" });
    expect(seen).toHaveLength(1);
    off();
    // The card unmounted (tab switch, unpin) and mounted again: its edits are still there, as the same object.
    const first = drafts.get("post1");
    expect(first).toEqual({ instagram: "Rewritten" });
    expect(drafts.get("post1")).toBe(first);
    // A reload (or iOS discarding the app) builds a new store over the same storage.
    const afterReload = createDraftStore<{ instagram: string }>("captions", () => storage);
    expect(afterReload.get("post1")).toEqual({ instagram: "Rewritten" });
    expect(afterReload.get("post2")).toBeNull();
  });

  it("a kept caption draft is dropped once the post went out, was rejected, or says the same", () => {
    const post = { status: "waiting", captions: { instagram: "Server text" } };
    expect(staleCaptionDraft(null, post)).toBe(false);
    expect(staleCaptionDraft({ instagram: "Typed" }, post)).toBe(false);
    expect(staleCaptionDraft({ instagram: "Typed" }, { ...post, status: "scheduled" })).toBe(false);
    expect(staleCaptionDraft({ instagram: "Typed" }, { ...post, status: "sent" })).toBe(true);
    expect(staleCaptionDraft({ instagram: "Typed" }, { ...post, status: "rejected" })).toBe(true);
    expect(staleCaptionDraft({ instagram: " Server text " }, post)).toBe(true);
  });

  it("Create and the queue keep their work in the draft stores", () => {
    const create = read("components/studio/create/Create.tsx");
    expect(create).toMatch(/createDraftStore<CreateDraft>\("create"\)/);
    // Restored on mount, saved as it changes, cleared once it is a post.
    expect(create).toMatch(/useState\(\(\) => createDrafts\.get\(initialOutput\)\)/);
    expect(create).toMatch(/createDrafts\.set\(initialOutput, JSON\.parse\(snapshot\)/);
    expect(create).toMatch(/createDrafts\.set\(initialOutput, null\)/);
    for (const kept of ["rendered", "captions", "storyCaps", "edits", "listingId"]) expect(create).toMatch(new RegExp(`${kept}: [^,]+ \\| null|${kept}: Edits`));
    const card = read("components/studio/queue/PostCard.tsx");
    expect(card).toMatch(/useDraft\(captionDrafts, post\.id\)/);
    expect(card).not.toMatch(/useState<Captions \| null>/);
  });
});

describe("the reel build outlives the Reels page", () => {
  const reel = { url: "https://pub-test.r2.dev/social/a/a-reel-1.mp4", width: 1080, height: 1920, durationSec: 42, heldSec: 0, size: 5_000_000 };

  it("runs to the end with nobody watching, keeps the result, and asks before a reload while it runs", async () => {
    const storage = memoryStorage();
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const builds = createReelBuilds(createDraftStore<BuiltReel>("reel", () => storage), () => target);
    let finishBuild!: (value: typeof reel) => void;
    const reported: (string | undefined)[] = [];
    const off = builds.subscribe(() => reported.push(builds.get().stage?.label));
    const running = builds.run({ listingId: "L1", audioUrl: "https://x/a.mp3" }, (report) => {
      report({ label: "Building the reel", fraction: 0.4 });
      return new Promise((resolve) => (finishBuild = resolve));
    });
    expect(builds.get().stage).toEqual({ label: "Building the reel", fraction: 0.4 });
    expect(target.addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    // A second tap while it runs does nothing.
    expect(await builds.run({ listingId: "L1", audioUrl: "https://x/a.mp3" }, async () => reel)).toBeNull();

    // The page unmounts (the user tapped Queue): the build goes on.
    off();
    finishBuild(reel);
    const done = await running;
    expect(done).toEqual({ ...reel, listingId: "L1", audioUrl: "https://x/a.mp3" });
    expect(builds.get()).toEqual({ stage: null, done });
    expect(target.removeEventListener).toHaveBeenCalledWith("beforeunload", target.addEventListener.mock.calls[0][1]);
    expect(reported).toContain("Building the reel");

    // Back on Reels after a reload: the finished reel is still there to post.
    const reloaded = createReelBuilds(createDraftStore<BuiltReel>("reel", () => storage), () => null);
    expect(reloaded.get().done).toEqual(done);
    reloaded.clear();
    expect(reloaded.get().done).toBeNull();
    expect(createReelBuilds(createDraftStore<BuiltReel>("reel", () => storage), () => null).get().done).toBeNull();
  });

  it("a failed build leaves nothing running and nothing half-done", async () => {
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const builds = createReelBuilds(createDraftStore<BuiltReel>("reel", () => memoryStorage()), () => target);
    await expect(builds.run({ listingId: "L1", audioUrl: "a" }, async () => Promise.reject(new Error("upload failed")))).rejects.toThrow(/upload failed/);
    expect(builds.get()).toEqual({ stage: null, done: null });
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("Reels reads the shared build and only offers a story for 3 to 60 seconds", () => {
    const page = read("components/studio/reels/Reels.tsx");
    expect(page).toMatch(/useSyncExternalStore\(reelBuilds\.subscribe, reelBuilds\.get/);
    expect(page).toMatch(/reelBuilds\.run\(/);
    expect(page).toMatch(/durationSec: reel\.durationSec \}\)/); // registerReel gets the length
    expect(page).toMatch(/disabled=\{posting !== null \|\| !storyOk\}/);
    // The failure case from the review: a 58 s preview with a 59.8 s narration is a 60.4 s reel.
    expect(storyVideoProblem(60.4, "this reel")).not.toBeNull();
    expect(storyVideoProblem(59.8, "this reel")).toBeNull();
  });
});

describe("Chrome's install offer", () => {
  function installEvent() {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as InstallEvent;
    const prompt = vi.fn(async () => {});
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    return { event, prompt };
  }

  it("is kept from page load for a button that mounts later, and used once", async () => {
    const page = new EventTarget();
    const offer = createInstallStore();
    offer.capture(page);
    offer.capture(page); // idempotent: one listener
    // Chrome fires it before any Install button exists (the Settings sheet is still closed).
    const { event, prompt } = installEvent();
    page.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); // no mini-infobar: our button opens the prompt
    // The sheet opens later, or Home mounts again after a trip to the queue: the offer is there.
    const changes = vi.fn();
    offer.subscribe(changes);
    expect(offer.get()).toBe(event);
    expect(await offer.prompt()).toBe("accepted");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(offer.get()).toBeNull();
    expect(changes).toHaveBeenCalled();
    expect(await offer.prompt()).toBeNull();

    // A new offer, then the app gets installed: the button goes.
    page.dispatchEvent(installEvent().event);
    expect(offer.get()).not.toBeNull();
    page.dispatchEvent(new Event("appinstalled"));
    expect(offer.get()).toBeNull();
  });

  it("InstallPrompt reads the page-load store, which the root layout loads", () => {
    const prompt = read("components/pwa/InstallPrompt.tsx");
    expect(prompt).toMatch(/useSyncExternalStore\(installOffer\.subscribe, installOffer\.get/);
    expect(prompt).not.toMatch(/addEventListener\("beforeinstallprompt"/);
    expect(read("components/pwa/ServiceWorkerRegister.tsx")).toMatch(/from "\.\/installEvent"/);
    expect(read("app/layout.tsx")).toMatch(/<ServiceWorkerRegister \/>/);
  });
});

describe("the glass palette strip", () => {
  const look = { style: "glass" as const, palette: "egypt", glass: "frost" as const, format: "ig_portrait" as const, shot: "https://ik.imagekit.io/shemoqmedi/listings/a/cover.webp" };

  it("doesn't fetch a backdrop per palette; the screenshot is one URL for every palette", () => {
    expect(miniFetchesAssets({ style: "glass" })).toBe(false);
    expect(miniFetchesAssets({ style: "swiss" })).toBe(true);
    // Palettes differ in the assets URL, never in the screenshot the browser loads.
    expect(assetsUrl(look)).not.toBe(assetsUrl({ ...look, palette: "night" }));
    expect(previewShotUrl(look.shot)).toBe(`${look.shot}?tr=w-1600%2Cf-jpg`);
    expect(previewShotUrl("https://quiet-owl.convex.cloud/api/storage/abc")).toBe("https://quiet-owl.convex.cloud/api/storage/abc");
    expect(previewShotUrl(null)).toBeNull();
    // A flat style's "auto" asks one URL whatever glass variant was last picked.
    const flat = { ...look, style: "swiss" as const, palette: "auto" };
    expect(assetsUrl({ ...flat, glass: "liquid" })).toBe(assetsUrl({ ...flat, glass: "tint" }));
  });

  it("the strip's small copies read the cache only in glass", () => {
    const stage = read("components/studio/create/Stage.tsx");
    expect(stage).toMatch(/<Mini look=\{looks\[i\]\} width=\{width\} fetchAssets=\{miniFetchesAssets\(looks\[i\]\)\} \/>/);
    expect(stage).toMatch(/shotUrl: previewShotUrl\(look\.shot\)/);
    expect(read("components/studio/create/useAssets.ts")).toMatch(/if \(url && allowFetch\) load\(url\)/);
  });
});

describe("the Settings sheet's messages", () => {
  it("push and sign-out outcomes show inside the sheet, not as toasts under its backdrop", () => {
    const sheet = read("components/studio/SettingsSheet.tsx");
    expect(sheet).toMatch(/<PushSwitch inline \/>/);
    expect(sheet).toMatch(/<SheetError error=\{error\} \/>/);
    expect(sheet).not.toMatch(/showError|showAlert/);
    const push = read("components/studio/PushSwitch.tsx");
    expect(push).toMatch(/inline \? setOutcome\(next\) : showAlert/);
    expect(push).toMatch(/role=\{outcome\.tone === "error" \? "alert" : "status"\}/);
  });
});

describe("tap targets", () => {
  const css = read("app/studio/studio.css");
  const minHeight = (selector: string) => {
    const rule = css.split("\n").find((line) => line.startsWith(`${selector} {`) || line.startsWith(`${selector},`));
    expect(rule, selector).toBeDefined();
    return Number(/min-height: (\d+)px/.exec(rule!)?.[1] ?? /[^-]height: (\d+)px/.exec(rule!)?.[1]);
  };

  it("are 44px, as the Studio stylesheet promises", () => {
    expect(css).toMatch(/44px targets/);
    for (const selector of [".st-seg > button", ".st-net-tabs > button", ".st-link", ".st-chip", ".st-icon-btn"]) {
      expect(minHeight(selector), selector).toBeGreaterThanOrEqual(44);
    }
    // The pinned post's close button keeps the 44px icon button.
    expect(read("components/studio/queue/PostCard.tsx")).not.toMatch(/width: 36, height: 36/);
  });

  it("Home's network badges are 44x44 targets that don't overlap", () => {
    const after = /\.st-badge-link::after \{[^}]*inset: -(\d+)px -(\d+)px;/.exec(css)!;
    const badge = /\.st-badge \{[^}]*height: (\d+)px/.exec(css)!;
    const link = /\.st-badge-link \{[^}]*min-width: (\d+)px/.exec(css)!;
    const gap = /\.st-badge-links \{[^}]*gap: (\d+)px/.exec(css)!;
    expect(Number(badge[1]) + 2 * Number(after[1])).toBeGreaterThanOrEqual(44);
    expect(Number(link[1]) + 2 * Number(after[2])).toBeGreaterThanOrEqual(44);
    expect(2 * Number(after[2])).toBeLessThanOrEqual(Number(gap[1]));
    expect(read("components/studio/home/Home.tsx")).toMatch(/className="st-badge st-badge-link"/);
  });
});

describe("the pinned preview while typing", () => {
  it("shrinks to a thumbnail while a field of its step has focus", () => {
    const css = read("app/studio/studio.css");
    const rule = /\.st-step:has\(:is\(input, textarea, select\):focus\) \.st-stage-sticky \.st-stage-box \{ --maxh: min\(16dvh, (\d+)px\); \}/.exec(css);
    expect(rule).not.toBeNull();
    // iPhone SE with the keyboard up leaves about 360px: top bar (56 + 20) + 120 + padding still leaves room for the field.
    expect(56 + 20 + Number(rule![1]) + 12).toBeLessThan(360 - 88);
    expect(css).toMatch(/\.st-step:has\(:is\(input, textarea, select\):focus\) \.st-stage-sticky \.st-stage-meta \{ display: none; \}/);
  });
});

describe("the admin's More sheet", () => {
  it("has a real backdrop that takes the tap, not a shadow the tap goes through", () => {
    const css = read("app/globals.css");
    expect(css).not.toMatch(/box-shadow: 0 0 0 100vmax/);
    expect(css).toMatch(/\.admin-sheet-backdrop \{ position: fixed; inset: 0;/);
    // The sheet and the tab bar sit above the backdrop.
    expect(css).toMatch(/\.admin-sheet \{ position: absolute; z-index: 2;/);
    expect(css).toMatch(/\.admin-tabbar \{ position: relative; z-index: 1;/);
    const shell = read("components/admin/AdminShell.tsx");
    expect(shell).toMatch(/<div className="admin-sheet-backdrop" aria-hidden="true" onClick=\{\(\) => setOpen\(false\)\} \/>/);
    // Inside the menu's wrapper, so the outside-press listener doesn't close it on pointerdown and let the click through.
    expect(shell.indexOf('className="admin-sheet-backdrop"')).toBeGreaterThan(shell.indexOf('<div ref={wrap} className="admin-tabbar-wrap">'));
  });
});

describe("unknown Studio paths", () => {
  it("call notFound(), so the Studio's own 404 renders inside its frame", () => {
    let thrown: unknown;
    try {
      StudioUnknownPage();
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { digest?: string }).digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(read("app/studio/not-found.tsx")).toMatch(/Studio home/);
  });
});
