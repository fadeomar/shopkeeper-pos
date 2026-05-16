import type { ButtonHTMLAttributes, PropsWithChildren, Ref } from "react";
import clsx from "clsx";
import { buttonSizes, buttonVariants, focusRing } from "@/lib/design/variants";

type ButtonVariant = keyof typeof buttonVariants;
type ButtonSize = keyof typeof buttonSizes;

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  ...props
}: PropsWithChildren<Props>) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap",
        "transition-colors duration-150 cursor-pointer select-none",
        "disabled:opacity-55 disabled:cursor-not-allowed disabled:pointer-events-none",
        focusRing,
        buttonSizes[size],
        buttonVariants[variant],
        fullWidth && "w-full",
        loading && "relative",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
