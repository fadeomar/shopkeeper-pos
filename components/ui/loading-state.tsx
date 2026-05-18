import clsx from "clsx";
export function LoadingState({
  title = "Loading…",
  description,
  compact,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center",
        compact ? "p-4" : "p-8",
        className,
      )}
    >
      <span
        className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
        aria-hidden
      />
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      )}
    </div>
  );
}
