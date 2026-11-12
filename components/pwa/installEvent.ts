// Chrome and Edge's install offer (the beforeinstallprompt event), caught
// once per page load and kept for whichever "Install app" button shows later.
//
// Chromium fires beforeinstallprompt once per document, as soon as the page
// is installable, and not again on client-side navigation. A component that
// listens only while it is mounted (the Studio's settings sheet, Home after a
// trip to another tab, the admin's /settings reached by a link) has missed it
// by then. So the listener goes on when this module loads (it is imported by
// ServiceWorkerRegister in the root layout), keeps the event, and
// InstallPrompt reads it with useSyncExternalStore.
// https://web.dev/articles/customize-install

/** Chrome's install event (not in the DOM typings: it is Chromium-only). */
export type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

type Target = Pick<EventTarget, "addEventListener">;

export function createInstallStore() {
  let deferred: InstallEvent | null = null;
  const listeners = new Set<() => void>();
  const targets = new WeakSet<Target>();
  const emit = () => listeners.forEach((l) => l());

  return {
    /** Starts listening on `target` (the window); once per target. */
    capture(target: Target) {
      if (targets.has(target)) return;
      targets.add(target);
      target.addEventListener("beforeinstallprompt", (event) => {
        // Keep Chrome's mini-infobar from showing; our button opens the prompt.
        event.preventDefault();
        deferred = event as InstallEvent;
        emit();
      });
      target.addEventListener("appinstalled", () => {
        deferred = null;
        emit();
      });
    },
    get: () => deferred,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * Opens the browser's install prompt. The event can be used once: it is
     * dropped first (Chrome fires a new one if the app is still installable).
     */
    async prompt(): Promise<"accepted" | "dismissed" | null> {
      const event = deferred;
      if (!event) return null;
      deferred = null;
      emit();
      await event.prompt();
      return (await event.userChoice).outcome;
    },
  };
}

/** The page's one store, listening from the moment this module loads. */
export const installOffer = createInstallStore();
if (typeof window !== "undefined") installOffer.capture(window);
