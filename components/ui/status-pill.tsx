import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { getStatusMeta, type StatusTone } from "@/lib/design/status";

export function StatusPill({
  status,
  tone,
  label,
  size = "sm",
  className,
}: {
  status: string;
  tone?: StatusTone;
  label?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = getStatusMeta(status);
  return (
    <Badge
      tone={tone ?? meta?.tone ?? "neutral"}
      size={size}
      className={className}
    >
      {label ?? meta?.label ?? status}
    </Badge>
  );
}
