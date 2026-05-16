import type { PropsWithChildren, HTMLAttributes } from "react";
import clsx from "clsx";
import { cardPadding, cardVariants } from "@/lib/design/variants";

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: keyof typeof cardPadding;
  variant?: keyof typeof cardVariants;
}

export function Card({
  children,
  className,
  padding = "md",
  variant = "default",
  ...props
}: PropsWithChildren<Props>) {
  return (
    <div
      className={clsx(
        "rounded-2xl",
        cardVariants[variant],
        cardPadding[padding],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
