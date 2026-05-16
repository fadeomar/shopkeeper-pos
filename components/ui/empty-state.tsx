import type { ReactNode } from "react";
import clsx from "clsx";
import { iconContainerTones, typographyClasses } from "@/lib/design/variants";

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl border-2 border-dashed border-slate-200 bg-white text-center",
        compact ? "p-5" : "p-8",
        className,
      )}
    >
      {icon && (
        <div
          className={clsx(
            "mx-auto mb-3 flex size-10 items-center justify-center rounded-2xl",
            iconContainerTones.neutral,
          )}
        >
          {icon}
        </div>
      )}
      <p className={typographyClasses.emptyTitle}>{title}</p>
      {description && (
        <p className={clsx("mt-1", typographyClasses.bodyMuted)}>
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
