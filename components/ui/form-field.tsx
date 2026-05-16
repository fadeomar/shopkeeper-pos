import type { ReactNode } from "react";
import clsx from "clsx";
import { formFieldSpacing, typographyClasses } from "@/lib/design/variants";

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={clsx(formFieldSpacing.default, className)}>
      {label && (
        <label htmlFor={htmlFor} className={typographyClasses.label}>
          {label}
          {required && <span className="ms-1 text-red-600">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className={typographyClasses.hint}>{hint}</p>}
      {error && <p className={typographyClasses.error}>{error}</p>}
    </div>
  );
}
