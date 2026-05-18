import type { ReactNode } from "react";
import clsx from "clsx";
export function EmptyState({
  title,
  description,
  icon,
  action,
  compact,
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
        compact ? "p-4" : "p-8",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex justify-center text-slate-400">{icon}</div>
      )}
      <p className="mb-1 text-base font-semibold text-slate-700">{title}</p>
      {description && <p className="text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
