"use client";

import clsx from "clsx";
import { NumberField } from "@/components/ui/number-field";

/**
 * QuantityStepper — POS quantity input with built-in +/- buttons.
 *
 * Now a thin wrapper around NumberField. The old version used three separate
 * components in a grid (Button, Input, Button) which had three problems:
 *   1. The native number input rejected the `text-center` className because
 *      globals.css forced `text-align: right` on every type="number". Fixed
 *      in the new globals + NumberField sets its own alignment.
 *   2. Typing in the middle field, then clicking +/-, lost the in-flight
 *      value because the buttons used the parent's React state directly
 *      instead of the input's current buffer. NumberField handles this.
 *   3. The three-column 44/64/44 grid was rigid — the inner field couldn't
 *      grow to fill available space inside a cart row.
 */
export function QuantityStepper({
  value,
  min = 0,
  max,
  disabled,
  onChange,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <NumberField
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
      precision="integer"
      showStepper
      align="center"
      disabled={disabled}
      fullWidth={false}
      className={clsx("w-[160px]", className)}
      aria-label="Quantity"
    />
  );
}
