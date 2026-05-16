"use client";

import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  function clamp(next: number) {
    if (Number.isNaN(next)) return min;
    return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, next));
  }

  return (
    <div
      className={clsx(
        "inline-grid grid-cols-[44px_minmax(64px,1fr)_44px] items-center gap-2",
        className,
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        aria-label="Decrease quantity"
      >
        −
      </Button>
      <Input
        type="number"
        inputSize="md"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
        className="text-center"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled || (max != null && value >= max)}
        onClick={() => onChange(clamp(value + 1))}
        aria-label="Increase quantity"
      >
        +
      </Button>
    </div>
  );
}
