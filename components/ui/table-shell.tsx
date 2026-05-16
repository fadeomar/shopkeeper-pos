import type { ReactNode } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { dividerClasses, typographyClasses } from "@/lib/design/variants";

export function TableShell({
  title,
  description,
  toolbar,
  children,
  className,
  empty,
  loading,
}: {
  title?: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  empty?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Card padding="none" className={clsx("overflow-hidden", className)}>
      {(title || description || toolbar) && (
        <div
          className={clsx(
            "flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between",
            dividerClasses.borderSubtle,
          )}
        >
          <div className="min-w-0">
            {title && (
              <h3 className={typographyClasses.sectionTitle}>{title}</h3>
            )}
            {description && (
              <p className={clsx("mt-1", typographyClasses.sectionDescription)}>
                {description}
              </p>
            )}
          </div>
          {toolbar && <div className="shrink-0">{toolbar}</div>}
        </div>
      )}
      {loading ? (
        <LoadingState compact />
      ) : empty ? (
        empty
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </Card>
  );
}
