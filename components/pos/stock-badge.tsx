import { StatusPill } from "@/components/ui/status-pill";

export function StockBadge({
  quantity,
  minQuantity,
  className,
  size = "sm",
}: {
  quantity: number;
  minQuantity?: number | null;
  className?: string;
  size?: "sm" | "md";
}) {
  const status =
    quantity <= 0
      ? "outOfStock"
      : minQuantity != null && quantity <= minQuantity
        ? "lowStock"
        : "inStock";
  return <StatusPill status={status} size={size} className={className} />;
}
