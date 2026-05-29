"use client";

/**
 * NumberField — POS-grade numeric input that replaces every
 * `<Input type="number">` in the app.
 *
 * Why a dedicated component:
 *   1. Native type="number" on mobile triggers wrong keyboards (some
 *      Android keyboards include letters when inputMode isn't set, iOS
 *      hides spinners but the field still accepts `e`, `E`, `+`, `-`).
 *   2. Scroll-wheel silently mutates type="number" values on desktop —
 *      a real bug for prices.
 *   3. `Number("")` is 0, so backspacing the field through React's
 *      onChange silently jumps to 0 or min. We hold a separate string
 *      buffer so the user can clear and retype.
 *   4. European locales paste "12,50" — Number() returns NaN. We accept
 *      either separator.
 *   5. Globals.css `direction: ltr` was fighting `text-center` overrides.
 *      Fixed in globals — this component sets its own alignment.
 *
 * The component preserves the existing `Input` size/error/slot API so
 * migration is mechanical: swap the tag, drop `type="number"`, done.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import clsx from "clsx";
import { Minus, Plus } from "lucide-react";

type NumberFieldSize = "xs" | "sm" | "md" | "lg";

export interface NumberFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    // We redefine `value` (number, not string), drop native number-input
    // attrs we replace with our own typed versions, and shadow `prefix`
    // (native HTML `prefix` is a string autofill hint — ours is a ReactNode
    // slot for currency symbols / units, so the types are incompatible).
    "value" | "onChange" | "type" | "size" | "min" | "max" | "step" | "defaultValue" | "prefix"
  > {
  value: number | "" | null | undefined;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** "integer" disables decimals + sets inputMode="numeric"; "decimal" allows fractions. */
  precision?: "integer" | "decimal";
  /** Number of decimal places when blur-formatting (decimal mode only). 2 = price. */
  decimalScale?: number;
  /** Render +/- stepper buttons inside the same control (good for qty fields). */
  showStepper?: boolean;
  /** Prefix or suffix (currency symbol, unit, %). Non-interactive. */
  prefix?: ReactNode;
  suffix?: ReactNode;
  error?: boolean;
  inputSize?: NumberFieldSize;
  fullWidth?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  /** Override empty-state behavior. Default: empty string allowed in field,
   * but emits `0` (or `min` if min > 0) on onValueChange when blurred empty. */
  emptyValue?: number;
}

const sizeClasses: Record<NumberFieldSize, string> = {
  xs: "min-h-9 text-xs",
  sm: "min-h-10 text-sm",
  md: "min-h-11 text-sm",
  lg: "min-h-12 text-base",
};

/** Parse a user-entered string into a number. Accepts both `.` and `,` as
 * the decimal separator; rejects letters, `e`, multiple separators. Returns
 * NaN if the string isn't a clean number — callers handle empty vs invalid. */
function parseNumeric(raw: string): number {
  if (raw == null || raw === "") return NaN;
  // Normalize Arabic-Indic digits (٠١٢٣…) to ASCII so users in Arabic mode
  // can type with the system keyboard and still hit our parser. Also handle
  // Eastern-Arabic numerals (۰۱۲…) used in Persian/Urdu keyboards.
  const normalized = raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(",", ".")
    .trim();
  // Strip leading + (allowed) and reject if it still contains anything
  // outside digits / single dot / leading minus.
  if (!/^-?\d*\.?\d*$/.test(normalized)) return NaN;
  if (normalized === "" || normalized === "-" || normalized === ".") return NaN;
  return Number(normalized);
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number" && next < min) next = min;
  if (typeof max === "number" && next > max) next = max;
  return next;
}

function formatForDisplay(value: number, precision: "integer" | "decimal", decimalScale: number): string {
  if (!Number.isFinite(value)) return "";
  if (precision === "integer") return String(Math.trunc(value));
  // Show up to `decimalScale` digits but strip trailing zeros for unedited
  // values — i.e. show "5" not "5.00" until the user explicitly types decimals.
  // Exception: when decimalScale is 2 (money), we DO keep trailing zeros to
  // signal "this is a currency value". Detected via decimalScale === 2 +
  // suffix presence in caller. We keep the simple rule here and let the
  // `decimalScale` prop drive precision; trailing zeros are preserved.
  return value.toFixed(decimalScale);
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  function NumberField(
    {
      value,
      onValueChange,
      min,
      max,
      step,
      precision = "decimal",
      decimalScale = 2,
      showStepper = false,
      prefix,
      suffix,
      error,
      inputSize = "md",
      fullWidth = true,
      align = "start",
      disabled,
      readOnly,
      className,
      emptyValue,
      onBlur,
      onFocus,
      onKeyDown,
      ...rest
    },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

    // Internal string buffer — the source of truth WHILE the field is focused.
    // When unfocused, we render the parent's numeric value formatted for display.
    // This split is what lets users backspace to empty without the value
    // silently snapping to `min`.
    const [draft, setDraft] = useState<string>(() =>
      value == null || value === "" ? "" : formatForDisplay(Number(value), precision, decimalScale),
    );
    const [focused, setFocused] = useState(false);

    // Sync external value -> draft when the parent updates and we're NOT
    // focused. While focused, the user owns the buffer.
    useEffect(() => {
      if (focused) return;
      if (value == null || value === "" || !Number.isFinite(Number(value))) {
        setDraft("");
      } else {
        setDraft(formatForDisplay(Number(value), precision, decimalScale));
      }
    }, [value, focused, precision, decimalScale]);

    // Resolve effective step: integers default to 1, decimals to the
    // smallest unit at the given scale (e.g. 0.01 for 2-decimal money).
    const effectiveStep =
      step ?? (precision === "integer" ? 1 : Math.pow(10, -decimalScale));

    const commit = useCallback(
      (next: number) => {
        const clamped = clamp(next, min, max);
        // Round to the configured precision so floating-point fuzz from
        // arithmetic (e.g. 0.1 + 0.2) doesn't leak into business data.
        const rounded =
          precision === "integer"
            ? Math.round(clamped)
            : Number(clamped.toFixed(decimalScale));
        onValueChange(rounded);
        return rounded;
      },
      [min, max, precision, decimalScale, onValueChange],
    );

    function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      setDraft(raw);
      // Only emit numeric updates when the buffer is a clean number.
      // Don't clamp DURING typing — that prevents the user from typing
      // "0.5" by clamping at "0" then "0." mid-stroke.
      const parsed = parseNumeric(raw);
      if (Number.isFinite(parsed)) {
        // Apply rounding only on commit, not while typing.
        onValueChange(parsed);
      }
    }

    function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
      setFocused(false);
      const parsed = parseNumeric(draft);
      if (!Number.isFinite(parsed)) {
        // Empty / invalid — emit the configured empty fallback (typically
        // 0, or `min` for fields that don't allow 0 like quantity).
        const fallback = emptyValue ?? (typeof min === "number" && min > 0 ? min : 0);
        const committed = commit(fallback);
        setDraft(formatForDisplay(committed, precision, decimalScale));
      } else {
        const committed = commit(parsed);
        setDraft(formatForDisplay(committed, precision, decimalScale));
      }
      onBlur?.(e);
    }

    function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
      setFocused(true);
      // Select-all on focus mirrors the cashier-friendly behavior of
      // physical till keypads: tap the field, type the new value, done.
      // We do this on a microtask so the click that brought focus to the
      // field finishes positioning the caret first.
      requestAnimationFrame(() => {
        innerRef.current?.select();
      });
      onFocus?.(e);
    }

    function step1(direction: 1 | -1) {
      const base =
        Number.isFinite(parseNumeric(draft))
          ? parseNumeric(draft)
          : Number.isFinite(Number(value))
            ? Number(value)
            : (emptyValue ?? min ?? 0);
      const next = base + direction * effectiveStep;
      const committed = commit(next);
      setDraft(formatForDisplay(committed, precision, decimalScale));
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      // ArrowUp/Down step the value — matches native number input ergonomics
      // for power users without the scroll-wheel hazard.
      if (e.key === "ArrowUp") {
        e.preventDefault();
        step1(1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        step1(-1);
      }
      onKeyDown?.(e);
    }

    // Block the scroll-wheel from silently changing prices/qty on desktop.
    function handleWheel(e: React.WheelEvent<HTMLInputElement>) {
      if (document.activeElement === innerRef.current) {
        e.currentTarget.blur();
      }
    }

    const numericValue = Number(value);
    const canDecrement = !disabled && !readOnly && (min == null || numericValue > min);
    const canIncrement = !disabled && !readOnly && (max == null || numericValue < max);

    const alignClass =
      align === "center" ? "text-center"
      : align === "end" ? "text-end"
      : "text-start";

    // Compose the visual frame. The `<input>` itself is unstyled — borders,
    // padding, and focus state live on the wrapper so prefix/suffix/stepper
    // slots can sit inside the same focus ring.
    return (
      <div
        className={clsx(
          "group relative inline-flex items-stretch rounded-xl border bg-surface transition-colors",
          // Use `:has(input:focus)` for the wrapper focus state — Tailwind v4
          // supports the `has-[]` variant cleanly. Falls back gracefully:
          // older browsers just don't get the highlighted ring.
          "has-[input:focus]:border-brand",
          "has-[input:focus]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_22%,transparent)]",
          sizeClasses[inputSize],
          fullWidth && "w-full",
          disabled && "opacity-60 cursor-not-allowed",
          readOnly && "bg-surface-soft",
          error
            ? "border-danger has-[input:focus]:border-danger has-[input:focus]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-danger)_22%,transparent)]"
            : "border-border-default hover:border-border-strong",
          className,
        )}
      >
        {showStepper && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Decrease"
            disabled={!canDecrement}
            onClick={() => step1(-1)}
            className={clsx(
              "shrink-0 flex items-center justify-center rounded-s-xl border-e border-border-subtle",
              "text-fg-secondary hover:bg-surface-soft active:bg-surface-muted",
              "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
              "transition-colors",
              // Min 44px touch target regardless of input size — these are
              // touched constantly during a sale.
              "w-11 sm:w-10",
            )}
          >
            <Minus size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}

        {prefix != null && (
          <span
            className={clsx(
              "pointer-events-none flex items-center text-fg-muted text-sm tabular-nums",
              showStepper ? "ps-2" : "ps-3",
            )}
            aria-hidden="true"
          >
            {prefix}
          </span>
        )}

        <input
          ref={innerRef}
          // Plain text + inputMode is the modern recommendation — picks the
          // right mobile keyboard without the type="number" quirks.
          type="text"
          inputMode={precision === "integer" ? "numeric" : "decimal"}
          // Pattern is advisory for browsers — the real validation is in our
          // parseNumeric. Keeps form autofill heuristics sensible.
          pattern={precision === "integer" ? "[0-9]*" : "[0-9.,]*"}
          // Stops mobile keyboards from auto-capitalizing and auto-correcting
          // numeric entry (was happening on iOS for the qty field).
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={rest.enterKeyHint ?? "done"}
          value={draft}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error || undefined}
          onChange={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          className={clsx(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted/70 tabular-nums",
            // Vertical padding by size; horizontal padding only on edges
            // that don't already have a slot/button.
            inputSize === "xs" && "py-1.5",
            inputSize === "sm" && "py-2",
            inputSize === "md" && "py-2.5",
            inputSize === "lg" && "py-3",
            // Start padding: stepper button covers it; prefix renders its own ps-3.
            !showStepper && prefix == null && "ps-3",
            prefix != null && "ps-1.5",
            // End padding: same logic mirrored.
            !showStepper && suffix == null && "pe-3",
            suffix != null && "pe-1.5",
            alignClass,
          )}
          {...rest}
        />

        {suffix != null && (
          <span
            className="pointer-events-none flex items-center pe-3 text-fg-muted text-sm tabular-nums"
            aria-hidden="true"
          >
            {suffix}
          </span>
        )}

        {showStepper && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Increase"
            disabled={!canIncrement}
            onClick={() => step1(1)}
            className={clsx(
              "shrink-0 flex items-center justify-center rounded-e-xl border-s border-border-subtle",
              "text-fg-secondary hover:bg-surface-soft active:bg-surface-muted",
              "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
              "transition-colors",
              "w-11 sm:w-10",
            )}
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  },
);
