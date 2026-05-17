import type { PropsWithChildren } from "react";
import clsx from "clsx";
export function Toolbar({
  children,
  className,
  align = "between",
  wrap = true,
}: PropsWithChildren<{
  className?: string;
  align?: "start" | "between" | "end";
  wrap?: boolean;
}>) {
  return (
    <div
      className={clsx(
        "flex gap-2",
        wrap && "flex-wrap",
        align === "between" && "items-center justify-between",
        align === "start" && "items-center justify-start",
        align === "end" && "items-center justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
