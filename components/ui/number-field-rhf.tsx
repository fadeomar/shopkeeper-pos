"use client";

/**
 * NumberFieldRHF — react-hook-form adapter for NumberField.
 *
 * Why this exists:
 *   The base NumberField uses `value` + `onValueChange` because it
 *   maintains an internal string buffer (see number-field.tsx). That
 *   breaks the pattern of `{...form.register("name")}` which RHF used
 *   everywhere with native inputs.
 *
 *   This adapter lets callers keep their existing RHF setup with one
 *   small change:
 *
 *     // BEFORE
 *     <Input type="number" step="0.01" {...form.register("buyPrice", { valueAsNumber: true })} />
 *
 *     // AFTER
 *     <NumberFieldRHF name="buyPrice" control={form.control} decimalScale={2} />
 *
 *   Validation, dirty tracking, and error state flow through Controller
 *   exactly as RHF expects. The schema (zod) doesn't need to change.
 *
 * When to use base NumberField vs RHF variant:
 *   - Inside a useForm() form → NumberFieldRHF
 *   - Local useState / standalone use → NumberField directly
 */

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { NumberField, type NumberFieldProps } from "./number-field";

interface NumberFieldRHFProps<TFieldValues extends FieldValues>
  extends Omit<NumberFieldProps, "value" | "onValueChange" | "name" | "error"> {
  name: FieldPath<TFieldValues>;
  control: Control<TFieldValues>;
  /**
   * Optional callback that fires AFTER the form state is updated.
   * Useful for derived calculations (e.g. updating change-due when the
   * paid amount changes). Receives the new numeric value.
   */
  onAfterChange?: (value: number) => void;
}

export function NumberFieldRHF<TFieldValues extends FieldValues>({
  name,
  control,
  onAfterChange,
  ...rest
}: NumberFieldRHFProps<TFieldValues>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <NumberField
          {...rest}
          // RHF stores anything; coerce to number-or-empty for NumberField's
          // controlled API. Undefined/null from initial state becomes "".
          value={
            typeof field.value === "number"
              ? field.value
              : field.value == null || field.value === ""
                ? ""
                : Number(field.value)
          }
          onValueChange={(v) => {
            field.onChange(v);
            onAfterChange?.(v);
          }}
          onBlur={field.onBlur}
          name={field.name}
          error={Boolean(fieldState.error)}
        />
      )}
    />
  );
}
