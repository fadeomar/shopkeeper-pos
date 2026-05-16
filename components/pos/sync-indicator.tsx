import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/status-pill";

export function SyncIndicator({
  status,
  label,
  className,
  size = "sm",
}: {
  status:
    | "online"
    | "offline"
    | "synced"
    | "pendingSync"
    | "conflict"
    | "error"
    | string;
  label?: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <StatusPill
      status={status}
      label={label}
      size={size}
      className={className}
    />
  );
}
