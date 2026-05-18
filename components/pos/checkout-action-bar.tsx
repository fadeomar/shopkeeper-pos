import type { ReactNode } from "react";
import clsx from "clsx";
import { actionRowClasses } from "@/lib/design/variants";

export function CheckoutActionBar({
  children,
  className,
  sticky = true,
}: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={clsx(
        actionRowClasses.stickyCheckout,
        sticky && "sticky bottom-0 z-30",
        className,
      )}
    >
      {children}
    </div>
  );
}
