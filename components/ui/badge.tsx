import type { ReactNode } from "react";
import clsx from "clsx";
import { badgeSizes, badgeTones } from "@/lib/design/variants";
import type { StatusTone } from "@/lib/design/status";

export function Badge({
  tone = "neutral",
  size = "sm",
  children,
  className,
}: {
  tone?: StatusTone;
  size?: keyof typeof badgeSizes;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center gap-1 rounded-full border font-medium whitespace-nowrap",
        badgeTones[tone],
        badgeSizes[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
