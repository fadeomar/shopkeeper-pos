import type { PropsWithChildren, ReactNode } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingState } from "@/components/ui/loading-state";
export function TableShell({
  title,
  description,
  toolbar,
  children,
  className,
  empty,
  loading,
}: PropsWithChildren<{
  title?: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  className?: string;
  empty?: ReactNode;
  loading?: boolean;
}>) {
  return (
    <SectionCard
      title={title}
      description={description}
      actions={toolbar}
      className={className}
      padding="sm"
    >
      <div className="overflow-x-auto">
        {loading ? <LoadingState compact /> : (empty ?? children)}
      </div>
    </SectionCard>
  );
}
