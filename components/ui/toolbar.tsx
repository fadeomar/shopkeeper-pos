import type { ReactNode } from "react";
import clsx from "clsx";

const alignClasses = {
  start: "justify-start",
  between: "justify-between",
  end: "justify-end",
} as const;

export function Toolbar({
  children,
  className,
  align = "between",
  wrap = true,
}: {
  children: ReactNode;
  className?: string;
  align?: keyof typeof alignClasses;
  wrap?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2",
        alignClasses[align],
        wrap && "flex-wrap",
        className,
      )}
    >
      {children}
    </div>
  );
}
