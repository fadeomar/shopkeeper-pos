import type { ReactNode } from "react";
import clsx from "clsx";
import { actionRowClasses, typographyClasses } from "@/lib/design/variants";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            {eyebrow}
          </p>
        )}
        <h2 className={typographyClasses.pageTitle}>{title}</h2>
        {description && (
          <p className={clsx("mt-1", typographyClasses.pageDescription)}>
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className={clsx(actionRowClasses.end, "shrink-0")}>{actions}</div>
      )}
    </section>
  );
}
