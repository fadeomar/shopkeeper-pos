import type { ReactNode } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/card";
import { typographyClasses } from "@/lib/design/variants";
import type { StatusTone } from "@/lib/design/status";

type SectionTone = Exclude<StatusTone, "info">;

const toneVariant: Record<
  SectionTone,
  "default" | "success" | "warning" | "danger"
> = {
  neutral: "default",
  success: "success",
  warning: "warning",
  danger: "danger",
};

export function SectionCard({
  title,
  description,
  actions,
  children,
  tone = "neutral",
  padding = "md",
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: SectionTone;
  padding?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <Card
      variant={toneVariant[tone]}
      padding={padding}
      className={clsx("flex flex-col gap-4", className)}
    >
      {(title || description || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </Card>
  );
}
