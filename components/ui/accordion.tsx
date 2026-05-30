"use client";

/**
 * Accordion — a small disclosure primitive for the guide. Stock Tailwind classes
 * only; inline-SVG chevron (no icon dependency).
 *
 *  - Self-managed open state (uncontrolled). `defaultOpen` to start open.
 *  - a11y: real <button> with aria-expanded + aria-controls → region; Enter/Space
 *    toggle natively; Escape collapses when focus is inside the panel.
 *  - RTL: chevron rotates only down↔up, so it's direction-agnostic; row uses
 *    logical padding (ps/pe via text-start) so it mirrors automatically.
 */

import { useId, useState, type PropsWithChildren, type ReactNode } from "react";
import { ChevronDownIcon } from "@/features/guide/components/icons";

export function Accordion({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={
        "divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white " +
        className
      }
    >
      {children}
    </div>
  );
}

export function AccordionItem({
  title,
  icon,
  defaultOpen = false,
  children,
}: PropsWithChildren<{
  title: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  const baseId = useId();
  const buttonId = `${baseId}-btn`;
  const panelId = `${baseId}-panel`;

  return (
    <div className="bg-white">
      <h3 className="m-0">
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:px-5"
        >
          {icon && (
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"
            >
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
            {title}
          </span>
          <ChevronDownIcon
            size={18}
            className={
              "shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none " +
              (open ? "rotate-180" : "")
            }
          />
        </button>
      </h3>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="px-4 pb-4 pt-0 text-sm leading-relaxed text-slate-600 sm:px-5"
        >
          {children}
        </div>
      )}
    </div>
  );
}
