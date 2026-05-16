import clsx from "clsx";
import { Card } from "@/components/ui/card";
import { PriceDisplay } from "@/components/pos/price-display";
import { dividerClasses } from "@/lib/design/variants";

function SummaryRow({
  label,
  value,
  currency,
  strong,
}: {
  label: string;
  value: number;
  currency?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-4",
        strong ? "text-base" : "text-sm",
      )}
    >
      <span
        className={strong ? "font-semibold text-slate-900" : "text-slate-500"}
      >
        {label}
      </span>
      <PriceDisplay
        value={value}
        currency={currency}
        emphasis={strong}
        size={strong ? "lg" : "md"}
      />
    </div>
  );
}

export function CartSummaryCard({
  subtotal,
  discount = 0,
  tax = 0,
  total,
  currency = "USD",
  className,
}: {
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  currency?: string;
  className?: string;
}) {
  return (
    <Card className={clsx("space-y-3", className)}>
      <SummaryRow label="Subtotal" value={subtotal} currency={currency} />
      <SummaryRow label="Discount" value={discount} currency={currency} />
      <SummaryRow label="Tax" value={tax} currency={currency} />
      <div className={clsx("border-t pt-3", dividerClasses.borderSubtle)}>
        <SummaryRow label="Total" value={total} currency={currency} strong />
      </div>
    </Card>
  );
}
