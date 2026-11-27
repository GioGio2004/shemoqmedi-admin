"use client";

import { useEffect, useState } from "react";

/** Copies a message template to the clipboard; says "Copied" for a moment. */
export function CopyButton({ text, className, label = "Copy message" }: { text: string; className?: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select and copy by hand" : label}</span>
    </button>
  );
}
