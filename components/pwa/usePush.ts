"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { VAPID_PUBLIC_KEY, isIos, isStandalone, keyBytes, madeWithKey, registerServiceWorker } from "./browser";

/**
 * Push on this device, for the signed-in admin:
 *   loading        still checking the browser
 *   unsupported    this browser has no web push
 *   needs-install  iPhone/iPad in Safari: push works only from the home screen app
 *   no-key         NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set on this deployment
 *   denied         notifications are blocked in the browser's settings
 *   off / on
 */
export type PushState = "loading" | "unsupported" | "needs-install" | "no-key" | "denied" | "off" | "on";

/** What this browser allows, before looking at any subscription. */
function support(): PushState | null {
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window) || !("Notification" in window)) {
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (!VAPID_PUBLIC_KEY) return "no-key";
  if (Notification.permission === "denied") return "denied";
  return null;
}

function serialize(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    origin: window.location.origin,
    userAgent: navigator.userAgent,
  };
}

/**
 * The push switch's state and actions. UI-free, so the Studio and the admin
 * can each draw their own switch. `enable` and `disable` throw on failure
 * for the caller to show.
 */
export function usePush() {
  const save = useMutation(api.push.subscribe);
  const forget = useMutation(api.push.unsubscribe);
  const [state, setState] = useState<PushState>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // On load: read this browser's subscription and re-save it, so the server
  // has it again after it was cleaned up or another admin signed in here.
  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<{ state: PushState; endpoint: string | null }> => {
      const blocked = support();
      if (blocked) return { state: blocked, endpoint: null };
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return { state: "off", endpoint: null };
      if (!madeWithKey(subscription, VAPID_PUBLIC_KEY)) {
        // Made with keys that were rotated since: it can't receive anything.
        await subscription.unsubscribe();
        return { state: "off", endpoint: null };
      }
      await save(serialize(subscription));
      return { state: "on", endpoint: subscription.endpoint };
    };
    check()
      .catch((err: unknown) => {
        console.warn("Could not read the push subscription", err);
        return { state: "off" as const, endpoint: null };
      })
      .then((result) => {
        if (cancelled) return;
        setState(result.state);
        setEndpoint(result.endpoint);
      });
    return () => {
      cancelled = true;
    };
  }, [save]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await registerServiceWorker();
      if (!registration) throw new Error("This browser can't run the notification worker.");
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const reusable = existing && madeWithKey(existing, VAPID_PUBLIC_KEY) ? existing : null;
      // One made with rotated keys blocks subscribing with the new ones.
      if (existing && !reusable) await existing.unsubscribe();
      const subscription =
        reusable ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
        }));
      await save(serialize(subscription));
      setEndpoint(subscription.endpoint);
      setState("on");
    } finally {
      setBusy(false);
    }
  }, [save]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await forget({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEndpoint(null);
      setState("off");
    } finally {
      setBusy(false);
    }
  }, [forget]);

  return { state, endpoint, busy, enable, disable };
}

export type Push = ReturnType<typeof usePush>;
