"use client";

/**
 * SearchableSelect — searchable dropdown with portal positioning on
 * desktop and bottom-sheet behavior on mobile.
 *
 * Public API is unchanged from the previous version — every existing call
 * site (10+ across products, bills, purchases, inventory, admin) keeps
 * working without modification.
 *
 * What changed from the previous version:
 *
 *   1. PORTAL on desktop — the panel renders to document.body so it can
 *      escape `overflow: hidden` parents (cards, table cells) and z-index
 *      stacking contexts (sticky checkout bar). The old `absolute` panel
 *      got clipped inside the POS cart card.
 *
 *   2. FLOATING placement — measures available space above/below and
 *      flips placement when there isn't room. No floating-ui dependency:
 *      a ~40 line measurement function does what we need. Recomputes on
 *      scroll/resize.
 *
 *   3. BOTTOM SHEET on mobile — at `< sm` the panel becomes a full-width
 *      sheet anchored to the bottom of the viewport, dismissible by
 *      backdrop tap. Matches native mobile picker patterns and avoids the
 *      iOS-keyboard-fights-dropdown problem.
 *
 *   4. ICONS — lucide ChevronDown on the trigger, Search in the search
 *      input, Check on the selected row, X on the clear button. The text
 *      "⌄" arrow is gone.
 *
 *   5. TOUCH outside-close — added `touchstart` alongside `mousedown` so
 *      a tap outside the open panel dismisses it on mobile.
 *
 *   6. KEYBOARD nav preserved — ArrowUp/Down, Enter, Escape still work
 *      from the search input. Selected option scrolls into view when
 *      highlighted.
 *
 * Offline note: the portal mount target (document.body) and ResizeObserver
 * are browser-native and don't require any network. The icons are
 * tree-shaken into the build by lucide-react.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/components/providers/locale-context";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  meta?: ReactNode;
  disabled?: boolean;
};

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  clearable?: boolean;
  className?: string;
  buttonClassName?: string;
  name?: string;
  id?: string;
}

// Breakpoint used to switch between popover and sheet. Mirrors Tailwind's
// default `sm:` so the trigger feels at home alongside the rest of the
// app's responsive layout.
const SHEET_BREAKPOINT = 640;

function useIsMobile() {
  // Defaults to true on SSR so the first mount uses the safer (sheet)
  // experience until JS hydrates; minimizes layout shift on small devices.
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia(`(max-width: ${SHEET_BREAKPOINT - 1}px)`).matches;
  });
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${SHEET_BREAKPOINT - 1}px)`);
    function handler(e: MediaQueryListEvent) {
      setIsMobile(e.matches);
    }
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

/**
 * Tracks the on-screen (visual) viewport so the mobile sheet can stay above
 * the virtual keyboard. When the keyboard opens, window.innerHeight does NOT
 * change but visualViewport.height shrinks; the difference is the keyboard
 * inset. Only runs while `active` (mobile sheet open) to avoid idle listeners.
 *
 * Returns padding (not bottom/left/right offsets) and a height, so it's
 * RTL-safe and never fights the desktop popover.
 */
function useKeyboardViewport(active: boolean): {
  keyboardInset: number;
  viewportHeight: number;
} {
  const [state, setState] = useState<{
    keyboardInset: number;
    viewportHeight: number;
  }>({ keyboardInset: 0, viewportHeight: 0 });

  useEffect(() => {
    if (!active || typeof window === "undefined") {
      setState({ keyboardInset: 0, viewportHeight: 0 });
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      setState({ keyboardInset: 0, viewportHeight: window.innerHeight });
      return;
    }
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setState({
        keyboardInset: Math.round(inset),
        viewportHeight: Math.round(vv.height),
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);

  return state;
}

interface FloatingRect {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "below" | "above";
}

/**
 * Measure the trigger's position relative to the viewport, decide whether
 * to place the panel above or below it, and return absolute coordinates
 * (in document space, since we render via portal to document.body).
 */
function computeFloatingRect(trigger: HTMLElement): FloatingRect {
  const rect = trigger.getBoundingClientRect();
  const viewport = window.innerHeight;
  const spaceBelow = viewport - rect.bottom;
  const spaceAbove = rect.top;
  const panelMaxNeeded = 360;
  const margin = 8;
  const safetyEdge = 12;

  // Prefer below. Flip only when below is materially smaller than above.
  // Hysteresis prevents the panel from jittering between placements when
  // the user scrolls right at the boundary.
  const placement: "below" | "above" =
    spaceBelow >= panelMaxNeeded || spaceBelow >= spaceAbove - 40
      ? "below"
      : "above";

  const maxHeight =
    placement === "below"
      ? Math.max(160, spaceBelow - safetyEdge)
      : Math.max(160, spaceAbove - safetyEdge);

  return {
    top:
      placement === "below"
        ? rect.bottom + margin + window.scrollY
        : rect.top - margin + window.scrollY, // will translateY(-100%) in render
    left: rect.left + window.scrollX,
    width: rect.width,
    maxHeight,
    placement,
  };
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  loading,
  clearable,
  className,
  buttonClassName,
  name,
  id,
}: SearchableSelectProps) {
  const { t } = useLocale();
  const resolvedPlaceholder = placeholder ?? t("searchableSelect.select");
  const resolvedSearchPlaceholder =
    searchPlaceholder ?? t("searchableSelect.search");
  const resolvedEmptyMessage = emptyMessage ?? t("searchableSelect.noOptions");

  // Stable IDs for ARIA relationships (combobox → listbox → options).
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const getOptionId = (index: number) => `${uid}-opt-${index}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [floatingRect, setFloatingRect] = useState<FloatingRect | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isMobile = useIsMobile();
  // Keyboard awareness for the mobile sheet only.
  const { keyboardInset, viewportHeight } = useKeyboardViewport(
    open && isMobile,
  );

  // Result-list height on mobile: fit within the *visible* viewport (above the
  // keyboard) after reserving room for the drag handle, search input, and
  // paddings. Falls back to the old cap when visualViewport is unavailable.
  const mobileListMaxHeight = useMemo(() => {
    const vh =
      viewportHeight ||
      (typeof window !== "undefined" ? window.innerHeight : 640);
    const reserved = 168; // drag handle + search input + paddings
    const available = vh - reserved;
    return Math.max(140, Math.min(available, 448));
  }, [viewportHeight]);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      [option.label, option.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [options, query]);

  // Re-measure when the popover opens, on scroll, on resize. Mobile
  // skips this — the sheet is positioned by CSS (fixed bottom) not by JS.
  const measure = useCallback(() => {
    if (!triggerRef.current || isMobile) {
      setFloatingRect(null);
      return;
    }
    setFloatingRect(computeFloatingRect(triggerRef.current));
  }, [isMobile]);

  useEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open || isMobile) return;
    function onScroll() {
      measure();
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, isMobile, measure]);

  // Outside-tap to dismiss. Listens to BOTH mousedown and touchstart so
  // mobile dismisses don't have to wait for a synthesized click. We
  // explicitly exclude clicks on the trigger so it doesn't toggle twice.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // Reset query + focus search when panel opens. On mobile we DON'T
  // auto-focus the search input — that forces the keyboard up before the
  // user has signaled they want it. They can tap to focus.
  useEffect(() => {
    if (open) {
      setHighlightedIndex(0);
      if (!isMobile) {
        window.setTimeout(() => inputRef.current?.focus(), 50);
      }
    } else {
      setQuery("");
    }
  }, [open, isMobile]);

  // Lock body scroll while the sheet is up so the page behind doesn't move
  // when the user drags inside the option list. Desktop popover doesn't
  // need this — it's a transient overlay.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  // Keep the highlighted row visible when scrolling via keyboard.
  useEffect(() => {
    if (!open) return;
    const row = panelRef.current?.querySelector<HTMLButtonElement>(
      `[data-index="${highlightedIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  function selectOption(option: SearchableSelectOption | undefined) {
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectOption(filtered[highlightedIndex] ?? filtered[0]);
    }
  }

  // The panel body (search + list) is shared between desktop and mobile —
  // only the container changes. Extracted as a render helper to keep
  // styling consistent between the two presentation modes.
  function renderPanelBody() {
    return (
      <>
        <div className="relative">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            ref={inputRef}
            value={query}
            placeholder={resolvedSearchPlaceholder}
            aria-label={resolvedSearchPlaceholder}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={
              open && filtered.length > 0
                ? getOptionId(highlightedIndex)
                : undefined
            }
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={clsx(
              "w-full rounded-xl border border-border-default bg-surface ps-9 pe-9 py-2.5 text-sm",
              "outline-none placeholder:text-fg-muted/70",
              "focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_22%,transparent)]",
              "transition-colors",
            )}
          />
          {query && (
            <button
              type="button"
              aria-label={t("common.clear")}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-muted hover:bg-surface-soft"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>

        <div
          id={listboxId}
          role="listbox"
          className="mt-2 overflow-y-auto rounded-xl"
          // Sheet height adapts to the visible viewport (keyboard-aware on
          // mobile); popover is constrained by floatingRect.maxHeight.
          style={
            isMobile
              ? { maxHeight: mobileListMaxHeight }
              : { maxHeight: (floatingRect?.maxHeight ?? 320) - 80 }
          }
        >
          {loading ? (
            <div className="px-3 py-6 text-center text-sm text-fg-muted">
              {t("common.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState title={resolvedEmptyMessage} compact />
          ) : (
            filtered.map((option, index) => {
              const isSelected = option.value === value;
              const isHighlighted = index === highlightedIndex;
              return (
                <button
                  key={option.value}
                  id={getOptionId(index)}
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={clsx(
                    "group flex w-full items-start gap-3 rounded-xl px-3 text-start text-sm transition-colors",
                    // Generous tap target on mobile, tighter on desktop.
                    isMobile ? "py-3" : "py-2.5",
                    isHighlighted && !isSelected && "bg-surface-soft",
                    isSelected && "bg-brand-soft text-brand",
                    option.disabled && "cursor-not-allowed opacity-50",
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  {/* Check icon takes the start position, reserving a fixed
                      slot whether selected or not, so labels align in a
                      vertical column rather than shifting when a row is
                      selected. */}
                  <span
                    className={clsx(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center",
                      isSelected ? "text-brand" : "text-transparent",
                    )}
                    aria-hidden
                  >
                    <Check size={16} strokeWidth={2.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx(
                        "block truncate",
                        isSelected ? "font-semibold" : "font-medium",
                      )}
                    >
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block truncate text-xs text-fg-muted">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {option.meta && (
                    <span className="shrink-0 self-center">{option.meta}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {clearable && value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            fullWidth
            className="mt-2"
            onClick={() => {
              onValueChange(null);
              setOpen(false);
            }}
          >
            {t("common.clear")}
          </Button>
        )}
      </>
    );
  }

  // The portal panel — only rendered when open. Mounted to document.body
  // so it's free of any parent's overflow/transform/z-index context.
  const portalContent =
    open && typeof window !== "undefined"
      ? createPortal(
          isMobile ? (
            // Mobile: bottom sheet
            <div
              className="fixed inset-0 z-50 flex flex-col justify-end animate-fade-in"
              // Backdrop. Tap dismisses; the panel below stops propagation.
              onClick={() => setOpen(false)}
              role="presentation"
            >
              <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                className={clsx(
                  "relative w-full rounded-t-3xl border-t border-border-default bg-surface p-4 shadow-pop animate-sheet-up",
                  // Safe-area bottom padding so the list sits clear of
                  // iOS home-indicator on devices without a hardware button.
                  // When the keyboard is open we replace it with a keyboard
                  // inset (below) to lift the sheet content above the keyboard.
                  keyboardInset === 0 && "pb-safe",
                )}
                // Bottom padding equal to the keyboard height pushes the search
                // input + results up so they stay visible above the keyboard.
                // Padding (not a bottom offset) keeps this RTL-safe.
                style={
                  keyboardInset > 0
                    ? { paddingBottom: keyboardInset }
                    : undefined
                }
              >
                {/* Drag handle — purely visual, but signals dismissibility */}
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-muted" />
                {renderPanelBody()}
              </div>
            </div>
          ) : (
            // Desktop: anchored popover
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="false"
              className="z-50 rounded-2xl border border-border-default bg-surface p-2 shadow-pop animate-pop-in"
              style={{
                position: "absolute",
                top: floatingRect?.top ?? 0,
                left: floatingRect?.left ?? 0,
                width: floatingRect?.width ?? "auto",
                minWidth: 240,
                // When placed above, the `top` is the trigger's top — we
                // shift the panel up by its own height with a translate.
                transform:
                  floatingRect?.placement === "above"
                    ? "translateY(-100%)"
                    : undefined,
              }}
            >
              {renderPanelBody()}
            </div>
          ),
          document.body,
        )
      : null;

  return (
    <div className={clsx("relative", className)}>
      <input type="hidden" name={name} value={value ?? ""} />
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((cur) => !cur)}
        className={clsx(
          // Match the visual language of the new NumberField wrapper so
          // controls in the same form row look like a family.
          "inline-flex w-full items-center justify-between gap-2 rounded-xl border bg-surface px-3 text-sm font-medium",
          "min-h-11 transition-colors",
          "hover:border-border-strong",
          // Focus ring drawn the same way as NumberField/Input — soft 3px
          // brand-colored shadow rather than the harsh default outline.
          "focus-visible:outline-none focus-visible:border-brand",
          "focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_22%,transparent)]",
          disabled && "opacity-60 cursor-not-allowed",
          open ? "border-brand" : "border-border-default",
          buttonClassName,
        )}
      >
        <span
          className={clsx(
            "min-w-0 truncate text-start",
            !selected && "text-fg-muted",
          )}
        >
          {selected?.label ?? resolvedPlaceholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={clsx(
            "shrink-0 text-fg-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {portalContent}
    </div>
  );
}
