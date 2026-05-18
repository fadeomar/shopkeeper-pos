import type { PropsWithChildren } from "react";
import clsx from "clsx";
export function PageShell({
  children,
  className,
  size = "default",
}: PropsWithChildren<{
  className?: string;
  size?: "default" | "wide" | "full";
}>) {
  return (
    <div
      className={clsx(
        "mx-auto w-full space-y-5",
        size === "default" && "max-w-6xl",
        size === "wide" && "max-w-7xl",
        size === "full" && "max-w-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
