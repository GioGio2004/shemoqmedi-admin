"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

/**
 * Admin dropdown in the house style: white panel, hairline border, black
 * check on the chosen row. Replaces the native <select>, with the same
 * keyboard model (arrows, Home/End, Enter/Space, Escape, Tab, type to jump).
 * Pair it with a visible label whose id is passed as `labelledBy`.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  labelledBy,
  disabled,
  invalid,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  labelledBy?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [dropUp, setDropUp] = useState(false);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  function openList(at = selectedIndex >= 0 ? selectedIndex : 0) {
    if (disabled) return;
    // Open upwards when there is not enough room below.
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setDropUp(window.innerHeight - rect.bottom < 300 && rect.top > window.innerHeight - rect.bottom);
    setHighlight(at);
    setOpen(true);
  }

  function close(focusButton = true) {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open || highlight < 0) return;
    const row = listRef.current?.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  /** Type the start of a label to jump to it. */
  function typeahead(key: string) {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const from = open ? highlight : selectedIndex;
    const order = [...options.slice(from + 1), ...options.slice(0, from + 1)];
    const hit = order.find((o) => o.label.toLowerCase().startsWith(t.text.toLowerCase()));
    if (!hit) return;
    const index = options.indexOf(hit);
    if (open) setHighlight(index);
    else onChange(hit.value);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else setHighlight((h) => Math.min(last, h + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList();
        else setHighlight((h) => Math.max(0, h - 1));
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setHighlight(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setHighlight(last);
        }
        break;
      case "Enter":
      case " ":
        if (e.key === " " && typed.current.text && Date.now() - typed.current.at < 600) {
          e.preventDefault();
          typeahead(" ");
          break;
        }
        e.preventDefault();
        if (open) choose(highlight);
        else openList();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        if (open) setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(e.key);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelledBy ? `${labelledBy} ${id}-value` : undefined}
        aria-activedescendant={open && highlight >= 0 ? `${id}-opt-${highlight}` : undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "admin-input flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-50",
          open && "border-[var(--foreground)]",
          invalid && "border-[var(--foreground)]",
        )}
      >
        <span id={`${id}-value`} className={cn("truncate", !selected && "text-[var(--muted-ink)]")}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={cn("size-4 shrink-0 transition-transform duration-200", open && "rotate-180")}
          fill="none"
        >
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          className={cn(
            "absolute inset-x-0 z-50 max-h-72 overflow-y-auto overscroll-contain rounded-2xl border border-[var(--line)] bg-[var(--background)] p-1.5",
            dropUp ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
          )}
        >
          {options.map((option, i) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                onPointerEnter={() => setHighlight(i)}
                onPointerDown={(e) => e.preventDefault()} // keep focus on the button
                onClick={() => choose(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[13px] select-none",
                  i === highlight && "bg-[var(--surface-raised)]",
                  isSelected && "font-semibold",
                )}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none">
                    <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
