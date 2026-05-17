import type React from "react";
import { Badge } from "@/components/ui/badge";
import {
  paymentStatusTone,
  syncStatusTone,
  type Tone,
} from "@/lib/design/status";
export function StatusPill({
  status,
  label,
  tone,
  size = "sm",
  className,
}: {
  status: string;
  label?: React.ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
  className?: string;
}) {
  const resolvedTone =
    tone ?? syncStatusTone[status] ?? paymentStatusTone[status] ?? "neutral";
  return (
    <Badge tone={resolvedTone} size={size} className={className}>
      {label ?? status}
    </Badge>
  );
}
