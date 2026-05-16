import clsx from "clsx";
import { formatCurrency } from "@/lib/utils/money";
import { priceDisplaySizes } from "@/lib/design/variants";

export function PriceDisplay({
  value,
  currency = "USD",
  size = "md",
  emphasis = false,
  className,
}: {
  value: number;
  currency?: string;
  size?: keyof typeof priceDisplaySizes;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "tabular-nums whitespace-nowrap",
        priceDisplaySizes[size],
        emphasis ? "font-bold text-slate-900" : "font-medium text-slate-700",
        className,
      )}
    >
      {formatCurrency(value, currency)}
    </span>
  );
}
