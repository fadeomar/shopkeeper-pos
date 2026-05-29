"use client";

/**
 * FitText — responsive text scaling for numbers that may outgrow their card.
 *
 * Why this exists:
 *   POS values can be legitimately long: "$115,540.30", "₪1,234,567.89".
 *   At a fixed `text-2xl` the string clips inside small dashboard cards.
 *
 *   Cutting money values with ellipsis is NEVER acceptable — a cashier
 *   reading "$7,020…" cannot tell if it's $7,020.43 or $7,020,432.10.
 *   This component picks a size that lets the FULL value render, stepping
 *   down through the size ladder as length grows. Truncation is never
 *   used as a fallback.
 *
 *   Three approaches were considered for sizing:
 *     1. CSS clamp() + container queries — pure CSS, but requires
 *        @container setup on every parent and tunes are coarse.
 *     2. Runtime measurement (fitty-style) — most flexible, but adds a
 *        ResizeObserver per cell and creates a flash of unstyled text on
 *        mount. Bad for offline-first where we want everything paint-
 *        ready immediately.
 *     3. Length-based size buckets — deterministic, same value always
 *        renders at the same size, no JS measurement, no flicker.
 *
 *   We use option 3. Currency strings are highly predictable in length
 *   so a simple length->size lookup gets us 95% of the way.
 *
 * Usage:
 *   <FitText value={formatCurrency(totalSales, currency)} size="2xl" />
 *
 *   That renders the value at text-2xl when short and scales down to
 *   text-xs when extremely long. The `size` prop is the MAXIMUM — it
 *   never scales up.
 */

import clsx from "clsx";
import type { HTMLAttributes } from "react";

type FitSize = "lg" | "xl" | "2xl" | "3xl";

interface FitTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  value: string;
  /** Maximum size for short strings. Scales down from here as length grows. */
  size?: FitSize;
  /** Direction override — defaults to "ltr" for currency/numeric strings
   * so the digit order and currency symbol stay readable in Arabic mode. */
  dir?: "ltr" | "rtl" | "auto";
}

/**
 * Length thresholds picked against the dashboard card width at the new
 * one-card-per-row mobile layout (≈320px content width on a 360px viewport).
 * At that width, with bold weights:
 *
 *   - text-3xl: ~14 characters fit
 *   - text-2xl: ~16 characters
 *   - text-xl:  ~20 characters
 *   - text-lg:  ~24 characters
 *   - text-base:~28 characters
 *   - text-sm:  ~32 characters
 *
 * Currency formatting adds ~3-4 chars overhead ("$" + ",." + 2 decimals),
 * so even values like $1,234,567,890.12 (18 chars) land at text-xl which
 * fits comfortably. Beyond text-sm we still step further rather than ever
 * truncate, because cut-off money values are dangerous in a POS context.
 */
const sizeLadders: Record<FitSize, string[]> = {
  "3xl": ["text-3xl", "text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-xs"],
  "2xl": ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-xs"],
  xl:    ["text-xl", "text-lg", "text-base", "text-sm", "text-xs"],
  lg:    ["text-lg", "text-base", "text-sm", "text-xs"],
};

/**
 * Map each step on the ladder to the maximum character count it can
 * comfortably hold inside a one-card-per-row mobile layout. Calibrated
 * for bold weights with tabular numerals.
 */
const sizeMaxChars: Record<string, number> = {
  "text-3xl": 12,
  "text-2xl": 14,
  "text-xl": 18,
  "text-lg": 22,
  "text-base": 26,
  "text-sm": 30,
  "text-xs": Infinity, // last resort — always wins, never truncate
};

function pickSize(length: number, ladder: FitSize): string {
  const rungs = sizeLadders[ladder];
  for (const cls of rungs) {
    if (length <= sizeMaxChars[cls]) return cls;
  }
  // Logically unreachable because text-xs has Infinity, but typed as
  // a safety net.
  return rungs[rungs.length - 1];
}

export function FitText({
  value,
  size = "2xl",
  dir = "ltr",
  className,
  ...rest
}: FitTextProps) {
  const sizeClass = pickSize(value.length, size);
  return (
    <span
      dir={dir}
      className={clsx(
        "tabular-nums leading-tight",
        // Allow the value to break onto two lines as the ULTIMATE safety
        // net for extreme cases (e.g. very long localized currencies on
        // very narrow ancestors). Truncation with ellipsis is explicitly
        // avoided — wrapping is always better than hiding digits.
        "whitespace-normal break-words",
        sizeClass,
        className,
      )}
      // min-width:0 lets us live inside a flex/grid cell that would
      // otherwise refuse to shrink and clip us; max-width:100% bounds the
      // span to its container.
      style={{
        minWidth: 0,
        maxWidth: "100%",
        display: "inline-block",
      }}
      {...rest}
    >
      {value}
    </span>
  );
}

