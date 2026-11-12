"use client";

import { Component, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./icons";

// Small building blocks shared by every Studio screen.

/** The page title block: an eyebrow (index + section), a big grotesk title, an optional line and actions. */
export function PageHead({ index, section, title, lede, actions }: { index: string; section: string; title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="st-head st-in">
      <p className="st-eyebrow">
        <b>{index}</b>
        <span>{section}</span>
      </p>
      <div className="st-head-row">
        <h1 className="st-h1">{title}</h1>
        {actions}
      </div>
      {lede && <p className="st-lede">{lede}</p>}
    </header>
  );
}

/**
 * A bottom sheet on phones, a centered dialog on wide screens (native
 * <dialog>: focus stays inside, Escape and a tap on the backdrop close it).
 * Its content mounts only while open, so each opening starts fresh.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  // Closing by Escape or the backdrop reports through onClose; the parent then sets open=false.
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The content stays while the sheet slides away, then unmounts.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open) return;
    const t = window.setTimeout(() => setShown(false), 360);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="st-sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {shown && (
        <div className="st-sheet-in">
          <span className="st-sheet-grip" aria-hidden="true" />
          <div className="st-sheet-head">
            <h2 id={titleId} className="st-sheet-title">
              {title}
            </h2>
            <button type="button" className="st-icon-btn" onClick={onClose} aria-label="Close">
              <CloseIcon size={20} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** A yes/no sheet instead of confirm(). `onConfirm` may be async: the sheet waits, then closes. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  tone = "ink",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  tone?: "ink" | "blue";
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // The caller showed the error; keep the sheet open to try again.
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="st-note">{body}</div>
      <div className="st-sheet-foot">
        <button type="button" className="st-btn st-btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={`st-btn ${tone === "blue" ? "st-btn-blue" : ""}`} onClick={confirm} disabled={busy} data-busy={busy}>
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/** An on/off switch (role="switch"). */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="st-switch" onClick={() => onChange(!checked)} disabled={disabled}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="st-switch-track" aria-hidden="true">
        <span className="st-switch-thumb" />
      </span>
    </button>
  );
}

export function Skel({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`st-skel ${className}`} style={style} aria-hidden="true" />;
}

/** A labelled field; the label points at the first control inside through `id`. */
export function Field({ label, id, aside, children }: { label: string; id: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-field">
      <label className="st-label" htmlFor={id}>
        <span>{label}</span>
        {aside}
      </label>
      {children}
    </div>
  );
}

/** Keeps one broken piece (a stale deep link, say) from taking the screen down. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
