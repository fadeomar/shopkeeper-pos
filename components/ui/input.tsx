import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { inputSizes, inputVariants } from "@/lib/design/variants";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  inputSize?: keyof typeof inputSizes;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    className,
    error,
    inputSize = "md",
    leftSlot,
    rightSlot,
    fullWidth = true,
    disabled,
    ...props
  },
  ref,
) {
  const input = (
    <input
      ref={ref}
      disabled={disabled}
      className={clsx(
        "min-w-0 border transition-colors duration-150 outline-none",
        "placeholder:text-slate-400",
        "focus:ring-2 focus:ring-offset-0",
        "disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-50",
        "read-only:bg-slate-50 read-only:cursor-default",
        inputSizes[inputSize],
        leftSlot && "ps-10",
        rightSlot && "pe-10",
        fullWidth && "w-full",
        error ? inputVariants.error : inputVariants.default,
        className,
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  );

  if (!leftSlot && !rightSlot) return input;

  return (
    <span
      className={clsx(
        "relative inline-flex items-center",
        fullWidth && "w-full",
      )}
    >
      {leftSlot && (
        <span className="pointer-events-none absolute start-3 text-slate-400">
          {leftSlot}
        </span>
      )}
      {input}
      {rightSlot && (
        <span className="absolute end-3 text-slate-400">{rightSlot}</span>
      )}
    </span>
  );
});
