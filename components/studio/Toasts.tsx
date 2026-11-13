"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { claimAlertViewport, dismissAlert, useAlerts } from "@/components/admin/Alerts";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";

// The app's alerts (showAlert / showError from components/admin/Alerts), drawn
// the Studio's way: glass capsules dropping from the top. While mounted, the
// admin's default alert stack stays empty. The host is a manual popover where
// supported, so a toast shows above an open sheet (both live in the top layer).
// While a modal dialog is open everything outside it is inert, so the host then
// moves inside the topmost one: its toasts stay tappable and announced, and a
// tap on one never falls through to the sheet's scrim.

/** A Studio modal dialog that is open (only inside .st: the toasts use its tokens). */
function isModal(d: HTMLDialogElement) {
  if (!d.closest(".st")) return false;
  try {
    return d.matches(":modal");
  } catch {
    return d.open;
  }
}

/** The modal dialog opened last that is still open, or null. */
function useTopModal(): HTMLDialogElement | null {
  const [top, setTop] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const stack: HTMLDialogElement[] = [];
    document.querySelectorAll("dialog").forEach((d) => {
      if (isModal(d)) stack.push(d);
    });
    const sync = () => setTop(stack[stack.length - 1] ?? null);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type !== "attributes" || !(r.target instanceof HTMLDialogElement)) continue;
        const d = r.target;
        const i = stack.indexOf(d);
        if (i >= 0) stack.splice(i, 1);
        if (isModal(d)) stack.push(d);
      }
      // A dialog unmounted while open (a route change) leaves the stack too.
      for (let i = stack.length - 1; i >= 0; i--) if (!stack[i].isConnected || !stack[i].open) stack.splice(i, 1);
      sync();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    sync();
    return () => mo.disconnect();
  }, []);
  return top;
}

export function StudioToasts() {
  const list = useAlerts();
  const host = useRef<HTMLDivElement>(null);
  const modal = useTopModal();

  useEffect(() => claimAlertViewport(), []);

  // Re-show the popover on every change so it lands on top of any sheet opened since.
  useLayoutEffect(() => {
    const el = host.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover?.();
      if (list.length) el.showPopover();
    } catch {
      // Not a popover here: it stays a fixed layer.
    }
  }, [list, modal]);

  const view = (
    <div ref={host} className="st-toasts" popover="manual" aria-live="polite">
      {list.map((alert) => (
        <div key={alert.id} className="st-toast" data-tone={alert.tone} role={alert.tone === "error" ? "alert" : "status"}>
          <span className="st-toast-ic" aria-hidden="true">
            {alert.tone === "error" ? <AlertIcon size={14} /> : <CheckIcon size={14} />}
          </span>
          <span className="st-toast-text">{alert.text}</span>
          <button type="button" className="st-toast-x" onClick={() => dismissAlert(alert.id)} aria-label="Dismiss">
            <CloseIcon size={16} />
          </button>
        </div>
      ))}
    </div>
  );
  return modal ? createPortal(view, modal) : view;
}
