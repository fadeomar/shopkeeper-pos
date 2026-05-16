import type { SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { inputSizes, inputVariants } from "@/lib/design/variants";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  selectSize?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

export function Select({
  className,
  error,
  selectSize = "md",
  fullWidth = true,
  ...props
}: Props) {
  return (
    <select
      className={clsx(
        "min-w-0 border bg-white transition-colors duration-150 outline-none cursor-pointer",
        "focus:ring-2 focus:ring-offset-0",
        "disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
        inputSizes[selectSize],
        fullWidth && "w-full",
        error ? inputVariants.error : inputVariants.default,
        className,
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}
