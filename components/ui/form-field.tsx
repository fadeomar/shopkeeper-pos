import type { ReactNode } from "react";
import clsx from "clsx";
import { typographyClasses } from "@/lib/design/variants";

interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: FormFieldProps) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className={typographyClasses.label}>
          {label}{" "}
          {required && (
            <span className="text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && <p className={typographyClasses.hint}>{hint}</p>}
      {error && (
        <p role="alert" className={typographyClasses.error}>
          {error}
        </p>
      )}
    </div>
  );
}
