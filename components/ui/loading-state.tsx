import type { ReactNode } from "react";
import clsx from "clsx";
import {
  loadingSpinnerClasses,
  typographyClasses,
} from "@/lib/design/variants";

export function LoadingState({
  title,
  description,
  compact = false,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-center gap-3 text-center text-slate-500",
        compact ? "p-5" : "p-8",
        className,
      )}
    >
      <span className={loadingSpinnerClasses.md} aria-hidden="true" />
      <div className="text-start">
        {title && <p className={typographyClasses.label}>{title}</p>}
        {description && <p className={typographyClasses.hint}>{description}</p>}
      </div>
    </div>
  );
}
