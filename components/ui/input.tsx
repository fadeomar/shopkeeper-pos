import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

type InputSize = "xs" | "sm" | "md" | "lg";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  inputSize?: InputSize;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  fullWidth?: boolean;
}

const sizeClasses: Record<InputSize, string> = {
  xs: "min-h-9 px-2.5 py-1.5 text-xs",
  sm: "min-h-10 px-3 py-2 text-sm",
  md: "min-h-11 px-3 py-2.5 text-sm",
  lg: "min-h-12 px-4 py-3 text-base",
};

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
      aria-invalid={error ? true : props["aria-invalid"]}
      className={clsx(
        "rounded-xl border bg-surface text-fg placeholder:text-fg-muted",
        "transition-colors duration-150",
        "focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface-soft",
        "read-only:bg-surface-soft read-only:cursor-default",
        sizeClasses[inputSize],
        leftSlot && "ps-10",
        rightSlot && "pe-10",
        fullWidth && "w-full",
        error
          ? "border-danger focus:ring-danger focus:border-danger"
          : "border-border-default",
        className,
      )}
      {...props}
    />
  );

  if (!leftSlot && !rightSlot) return input;

  return (
    <span className={clsx("relative inline-flex", fullWidth && "w-full")}>
      {leftSlot ? (
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted">
          {leftSlot}
        </span>
      ) : null}
      {input}
      {rightSlot ? (
        <span className="absolute inset-y-0 end-3 flex items-center text-fg-muted">
          {rightSlot}
        </span>
      ) : null}
    </span>
  );
});
