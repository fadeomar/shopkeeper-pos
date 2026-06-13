import { cloneElement, isValidElement, useId, type ReactNode } from "react";
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
  const generatedId = useId();
  // Associate the label with its control. Callers may pass an explicit
  // `htmlFor`; otherwise generate an id and inject it into a single input-like
  // child so the label is programmatically linked. Without this the sibling
  // <label> labels nothing and screen readers fall back to the placeholder.
  const fieldId = htmlFor ?? generatedId;
  const child =
    !htmlFor &&
    isValidElement<{ id?: string }>(children) &&
    children.props.id === undefined
      ? cloneElement(children, { id: fieldId })
      : children;

  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={fieldId} className={typographyClasses.label}>
          {label}
          {required && (
            <span className="text-danger" aria-hidden="true">
              {" "}*
            </span>
          )}
        </label>
      )}
      {child}
      {hint && !error && <p className={typographyClasses.hint}>{hint}</p>}
      {error && (
        <p role="alert" className={typographyClasses.error}>
          {error}
        </p>
      )}
    </div>
  );
}
