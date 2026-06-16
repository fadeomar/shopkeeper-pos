"use client";

/**
 * ActionMenu — a compact "⋯" (kebab) trigger that opens a dropdown of row
 * actions. Built for table action columns where showing every action inline
 * makes the row read like a cloud of status chips.
 *
 * Why hand-rolled (no headless lib): offline-first, and the interaction is
 * small. The menu is portaled to <body> and positioned by the trigger's
 * bounding rect so it escapes the table's horizontal overflow clipping.
 *
 * Behavior: click-outside / Escape / scroll / resize all close it. Opens
 * downward, flips up near the viewport bottom. RTL-aware alignment. Keyboard:
 * arrow up/down move between items, Escape returns focus to the trigger,
 * Enter/Space activate (native <button>).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { MoreVertical } from "@/components/ui/icons";

export interface ActionMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  /** Render a thin divider above this item (e.g. before destructive actions). */
  dividerBefore?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

const MENU_WIDTH = 224; // matches w-56
const GAP = 4;

export function ActionMenu({
  items,
  label,
}: {
  items: ActionMenuItem[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const isRtl =
      document.documentElement.getAttribute("dir") === "rtl";

    // Horizontal: align the menu's inline-end edge to the trigger.
    let left = isRtl ? rect.left : rect.right - MENU_WIDTH;
    left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));

    // Vertical: prefer below; flip above when the estimated menu height
    // wouldn't fit in the space below the trigger.
    const estHeight = items.length * 40 + 16;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estHeight && rect.top > spaceBelow;
    const top = openUp
      ? Math.max(8, rect.top - estHeight - GAP)
      : rect.bottom + GAP;

    setPos({ top, left });
  }, [items.length]);

  useLayoutEffect(() => {
    if (open) computePosition();
  }, [open, computePosition]);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onScrollOrResize() {
      // A portaled menu would visually detach from its trigger on scroll;
      // closing is simpler and less jarring than live-tracking.
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // Focus the first enabled item when the menu opens.
  useEffect(() => {
    if (!open || !pos) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      'button[role="menuitem"]:not([disabled])',
    );
    const timer = window.setTimeout(() => first?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, [open, pos]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const focusable = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        'button[role="menuitem"]:not([disabled])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const idx = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIdx =
      e.key === "ArrowDown"
        ? (idx + 1) % focusable.length
        : (idx - 1 + focusable.length) % focusable.length;
    focusable[nextIdx]?.focus({ preventScroll: true });
  }

  function select(item: ActionMenuItem) {
    setOpen(false);
    item.onSelect();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex h-9 w-9 items-center justify-center rounded-xl",
          "border border-border-default bg-surface text-fg-secondary",
          "transition-colors hover:bg-surface-soft hover:border-border-strong",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
          open && "bg-surface-soft border-border-strong",
        )}
      >
        <MoreVertical size={18} aria-hidden />
      </button>

      {open &&
        pos &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className={clsx(
              "z-[60] overflow-y-auto rounded-2xl border border-border-default bg-surface p-1.5 shadow-2xl",
              "max-h-[min(20rem,calc(100dvh-1rem))] animate-pop-in",
            )}
          >
            {items.map((item) => (
              <div key={item.key}>
                {item.dividerBefore && (
                  <div className="my-1 border-t border-border-subtle" aria-hidden />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => select(item)}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm font-medium",
                    "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                    "focus-visible:outline-none focus-visible:bg-surface-soft",
                    item.tone === "danger"
                      ? "text-danger hover:bg-danger-soft"
                      : "text-fg-secondary hover:bg-surface-soft",
                  )}
                >
                  {item.icon && <span className="shrink-0" aria-hidden>{item.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
