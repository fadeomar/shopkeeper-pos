import { StatusPill } from "@/components/ui/status-pill";
export function StockBadge({
  quantity,
  minQuantity,
  size = "sm",
  className,
}: {
  quantity: number;
  minQuantity?: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const status =
    quantity <= 0
      ? "outOfStock"
      : minQuantity != null && quantity <= minQuantity
        ? "lowStock"
        : "inStock";
  const tone =
    status === "outOfStock"
      ? "danger"
      : status === "lowStock"
        ? "warning"
        : "success";
  const label =
    status === "outOfStock"
      ? "Out of stock"
      : status === "lowStock"
        ? "Low stock"
        : "In stock";
  return (
    <StatusPill
      status={status}
      tone={tone}
      label={label}
      size={size}
      className={className}
    />
  );
}
