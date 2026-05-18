import clsx from "clsx";
import { formatCurrency } from "@/lib/utils/money";
export function PriceDisplay({
  value,
  currency = "USD",
  size = "md",
  emphasis,
  className,
}: {
  value: number;
  currency?: string;
  size?: "sm" | "md" | "lg" | "xl";
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "tabular-nums",
        size === "sm" && "text-sm",
        size === "md" && "text-base",
        size === "lg" && "text-lg",
        size === "xl" && "text-2xl",
        emphasis && "font-black text-slate-900",
        !emphasis && "font-semibold",
        className,
      )}
    >
      {formatCurrency(value, currency)}
    </span>
  );
}
