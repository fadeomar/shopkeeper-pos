import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * PageHeader — title row for full-page screens.
 *
 * New in this revision: an optional `icon` slot that renders a tinted
 * tile alongside the title. Used judiciously — most pages don't need
 * one — but for prominent flows (POS, reports, dashboard) a leading
 * icon gives the header visual anchor that matches the new sidebar
 * iconography.
 *
 * The icon tile uses brand-soft as its background, so it picks up
 * theme changes automatically. Sized to align with the title's
 * cap-height baseline at the default sm-and-up `text-3xl` size.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * Optional leading icon — render a lucide icon element here.
   * Wrapped in a tinted tile by the component.
   */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <span
            aria-hidden
            className={clsx(
              "flex shrink-0 items-center justify-center rounded-xl",
              "h-11 w-11 sm:h-12 sm:w-12",
              "bg-brand-soft text-brand",
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-fg sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-fg-muted">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}
