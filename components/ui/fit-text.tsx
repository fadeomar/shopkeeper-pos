"use client";

/**
 * FitText — responsive text scaling for numbers that may outgrow their card.
 *
 * Why this exists:
 *   POS values can be legitimately long: "$115,540.30", "₪1,234,567.89".
 *   At a fixed `text-2xl` the string clips or wraps inside small cards.
 *
 *   Cutting money values with ellipsis is NEVER acceptable — a cashier
 *   reading "$7,020…" cannot tell if it's $7,020.43 or $7,020,432.10.
 *   Wrapping a number mid-digit ("US$280.0" / "0") is just as unreadable.
 *
 * How it works:
 *   The value renders on a SINGLE line and we measure how wide it would be
 *   at the maximum font size against the actual content width of the parent
 *   (via canvas text measurement). If it doesn't fit, we scale the font down
 *   just enough that it does — never truncating, never wrapping.
 *
 *   An earlier version used static length→size buckets calibrated for the
 *   one-card-per-row dashboard (~320px). That mis-fired in denser 2-col
 *   layouts (shift / reports cards ≈ 130px) where the same value needed to
 *   shrink far more — so it wrapped. Measuring the real width fixes every
 *   layout without per-card calibration.
 *
 * Offline note: canvas + ResizeObserver are browser-native, no network. The
 * app uses system font stacks, so there's no late web-font reflow.
 */

import clsx from "clsx";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";

type FitSize = "lg" | "xl" | "2xl" | "3xl";

// Maximum font size (px) per ladder rung — mirrors Tailwind's text-* sizes.
const MAX_PX: Record<FitSize, number> = {
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
};

// Never shrink below this — past it the value is unreadable and the card
// should grow / wrap the layout instead. Realistic POS values never reach it.
const MIN_PX = 11;

// Tabular numerals render slightly wider than the canvas's proportional
// measurement, and symbols like "US$" add a little. Pad the measured width so
// we err on the side of shrinking rather than overflowing.
const WIDTH_SAFETY = 1.06;

// SSR-safe layout effect (avoids the useLayoutEffect-on-server warning).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// One shared offscreen canvas for all measurements — cheap and never painted.
let sharedCanvas: HTMLCanvasElement | null = null;
function measureTextWidth(
  text: string,
  fontPx: number,
  fontFamily: string,
  fontWeight: string,
): number {
  if (typeof document === "undefined") return 0;
  sharedCanvas ??= document.createElement("canvas");
  const ctx = sharedCanvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

interface FitTextProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  value: string;
  /** Maximum size for short strings. Scales down from here as needed. */
  size?: FitSize;
  /** Direction override — defaults to "ltr" for currency/numeric strings so
   * the digit order and currency symbol stay readable in Arabic mode. */
  dir?: "ltr" | "rtl" | "auto";
}

export function FitText({
  value,
  size = "2xl",
  dir = "ltr",
  className,
  style,
  ...rest
}: FitTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontPx, setFontPx] = useState<number>(MAX_PX[size]);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const maxPx = MAX_PX[size];

    const recompute = () => {
      const cs = window.getComputedStyle(parent);
      const padX =
        parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
      const avail = parent.clientWidth - padX;
      if (!Number.isFinite(avail) || avail <= 0) return;

      const elStyle = window.getComputedStyle(el);
      const naturalWidth =
        measureTextWidth(value, maxPx, elStyle.fontFamily, elStyle.fontWeight) *
        WIDTH_SAFETY;

      let next = maxPx;
      if (naturalWidth > avail && naturalWidth > 0) {
        next = Math.max(MIN_PX, Math.floor((avail / naturalWidth) * maxPx));
      }
      // Only update when it actually changes — avoids needless renders and
      // keeps the ResizeObserver from churning.
      setFontPx((prev) => (prev !== next ? next : prev));
    };

    recompute();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(recompute);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [value, size]);

  const mergedStyle: CSSProperties = {
    fontSize: `${fontPx}px`,
    display: "inline-block",
    maxWidth: "100%",
    minWidth: 0,
    ...style,
  };

  return (
    <span
      ref={ref}
      dir={dir}
      className={clsx(
        "tabular-nums leading-tight whitespace-nowrap",
        className,
      )}
      style={mergedStyle}
      {...rest}
    >
      {value}
    </span>
  );
}
