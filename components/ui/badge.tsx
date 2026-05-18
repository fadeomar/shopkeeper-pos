import type { PropsWithChildren, HTMLAttributes } from "react";
import clsx from "clsx";
import { badgeTones } from "@/lib/design/variants";

type Tone = keyof typeof badgeTones;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: "sm" | "md";
}

export function Badge({
  children,
  className,
  tone = "neutral",
  size = "sm",
  ...props
}: PropsWithChildren<BadgeProps>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
