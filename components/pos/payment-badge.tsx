import { StatusPill } from "@/components/ui/status-pill";

export function PaymentBadge({
  status,
  className,
  size = "sm",
}: {
  status:
    | "paid"
    | "unpaid"
    | "partial"
    | "refunded"
    | "draft"
    | "cancelled"
    | string;
  className?: string;
  size?: "sm" | "md";
}) {
  return <StatusPill status={status} size={size} className={className} />;
}
