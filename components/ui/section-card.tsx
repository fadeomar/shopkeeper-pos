import type { PropsWithChildren, ReactNode } from "react";
import { Card } from "@/components/ui/card";
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  padding = "md",
}: PropsWithChildren<{
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg";
}>) {
  return (
    <Card padding={padding} className={className}>
      {(title || description || actions) && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title && (
              <h2 className="text-base font-bold text-slate-900">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-slate-500">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}
