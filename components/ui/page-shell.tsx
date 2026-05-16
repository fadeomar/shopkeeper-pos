import type { ReactNode } from "react";
import clsx from "clsx";
import { pageShellVariants, sectionSpacing } from "@/lib/design/variants";

export function PageShell({
  children,
  className,
  size = "default",
  spacing = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: keyof typeof pageShellVariants;
  spacing?: keyof typeof sectionSpacing;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col",
        pageShellVariants[size],
        sectionSpacing[spacing],
        className,
      )}
    >
      {children}
    </div>
  );
}
