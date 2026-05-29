"use client";

/**
 * MoneyInput / MoneyInputRHF — convenience wrappers around NumberField
 * pre-configured for currency amounts.
 *
 * Differences from raw NumberField:
 *   - precision="decimal" decimalScale={2} always
 *   - align="end" (right-aligned, conventional for money)
 *   - inputSize="lg" default (larger touch target for payment fields)
 *   - prefix shows the locale currency symbol via currencySymbol()
 *
 * MoneyInputRHF adds a react-hook-form Controller layer so callers don't
 * need to wire field.value / field.onChange manually.
 */

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { NumberField, type NumberFieldProps } from "./number-field";
import { currencySymbol } from "@/lib/utils/money";

export interface MoneyInputProps
  extends Omit<NumberFieldProps, "precision" | "decimalScale" | "prefix" | "align"> {
  currency: string;
}

export function MoneyInput({ currency, inputSize = "lg", ...rest }: MoneyInputProps) {
  return (
    <NumberField
      {...rest}
      precision="decimal"
      decimalScale={2}
      align="end"
      inputSize={inputSize}
      prefix={currencySymbol(currency)}
    />
  );
}

interface MoneyInputRHFProps<TFieldValues extends FieldValues>
  extends Omit<MoneyInputProps, "value" | "onValueChange" | "name" | "error"> {
  name: FieldPath<TFieldValues>;
  control: Control<TFieldValues>;
  onAfterChange?: (value: number) => void;
}

export function MoneyInputRHF<TFieldValues extends FieldValues>({
  name,
  control,
  onAfterChange,
  ...rest
}: MoneyInputRHFProps<TFieldValues>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <MoneyInput
          {...rest}
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
