// Unfinished work kept on this device, so it survives leaving a Studio page
// (the tab bar is always live), a reload, or iOS discarding the installed app
// while it is in the background. localStorage, not sessionStorage: a
// standalone web app that iOS evicted starts a new session when reopened.
//
// Every read and write is wrapped: storage can be missing or throw (private
// mode, blocked site data, a full quota), and then the Studio simply works
// without keeping drafts. Drafts expire after DRAFT_TTL_MS.

const PREFIX = "studio:";
export const DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

type Stored<T> = { at: number; value: T };

/** What drafts are kept in (the browser's localStorage; a stand-in in tests). */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The draft under `key`, or null (none, expired, unreadable, or no storage). */
export function readDraft<T>(key: string, store: DraftStorage | null = browserStorage(), now = Date.now()): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.at !== "number" || now - parsed.at > DRAFT_TTL_MS) {
      store.removeItem(PREFIX + key);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

/** Keeps `value` under `key`; null removes it. */
export function writeDraft<T>(key: string, value: T | null, store: DraftStorage | null = browserStorage(), now = Date.now()) {
  if (!store) return;
  try {
    if (value === null) store.removeItem(PREFIX + key);
    else store.setItem(PREFIX + key, JSON.stringify({ at: now, value } satisfies Stored<T>));
  } catch {
    // Full or blocked: the draft lives only in memory (this page load).
  }
}

/**
 * Drafts by id, shared by every component that reads one (a queue card that
 * remounts finds its draft again). For useSyncExternalStore: get() returns
 * the same object until set() replaces it.
 */
export function createDraftStore<T>(prefix: string, getStorage: () => DraftStorage | null = browserStorage) {
  const cache = new Map<string, T | null>();
  const listeners = new Set<() => void>();
  return {
    get(id: string): T | null {
      if (!cache.has(id)) cache.set(id, readDraft<T>(`${prefix}:${id}`, getStorage()));
      return cache.get(id) ?? null;
    },
    set(id: string, value: T | null) {
      cache.set(id, value);
      writeDraft(`${prefix}:${id}`, value, getStorage());
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type DraftStore<T> = ReturnType<typeof createDraftStore<T>>;
