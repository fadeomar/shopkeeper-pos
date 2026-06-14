"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useLocale } from "@/components/providers/locale-context";
import { formatCurrency } from "@/lib/utils/money";
import {
  calculateWeightedLineTotal,
  formatWeight,
  gramsToKg,
  parseWeightInput,
} from "@/lib/utils/weight";
import type { Product } from "@/types/domain";

/** Quick-pick weights, in grams. kg/g only for the first release. */
const PRESETS_GRAMS = [250, 500, 1000, 1500];

interface WeightEditorModalProps {
  open: boolean;
  product: Product | null;
  /** Pre-fill the custom field (editing an existing cart line). */
  initialGrams?: number;
  currency: string;
  onConfirm: (grams: number) => void;
  onClose: () => void;
}

/**
 * Focused weight picker shown when a weight product is added to / edited in the
 * cart. Quick presets commit immediately (fastest flow); a custom kg value is
 * typed then confirmed. Validates against available stock (grams). No global
 * "weight mode" — this opens only for weight products.
 */
export function WeightEditorModal({
  open,
  product,
  initialGrams,
  currency,
  onConfirm,
  onClose,
}: WeightEditorModalProps) {
  const { t } = useLocale();
  const [customKg, setCustomKg] = useState("");

  // Reset the custom field whenever the editor opens for a (different) product.
  useEffect(() => {
    if (open) setCustomKg(initialGrams ? String(gramsToKg(initialGrams)) : "");
  }, [open, initialGrams, product?.id]);

  const availableGrams = product?.quantityInStock ?? 0;
  const pricePerKg = product?.sellPrice ?? 0;

  const customGrams = useMemo(() => parseWeightInput(customKg, "kg"), [customKg]);
  const customExceeds = customGrams !== null && customGrams > availableGrams;
  const customValid = customGrams !== null && customGrams > 0 && !customExceeds;
  const customTotal = customGrams && customGrams > 0
    ? calculateWeightedLineTotal(pricePerKg, customGrams)
    : 0;

  function commit(grams: number) {
    if (grams <= 0 || grams > availableGrams) return;
    onConfirm(grams);
  }

  if (!product) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product.name}
      description={`${formatCurrency(pricePerKg, currency)} ${t("weight.perKgSuffix")}`}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!customValid} onClick={() => customGrams && commit(customGrams)}>
            {t("weight.addToCart")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">
            {t("weight.chooseWeight")}
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS_GRAMS.map((grams) => (
              <Button
                key={grams}
                type="button"
                variant="secondary"
                className="h-12 text-base"
                disabled={grams > availableGrams}
                onClick={() => commit(grams)}
              >
                {formatWeight(grams)}
              </Button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("weight.customWeight")}
          </span>
          <div className="flex items-center gap-2">
            <Input
              value={customKg}
              onChange={(e) => setCustomKg(e.target.value)}
              inputMode="decimal"
              type="text"
              placeholder="0.750"
              dir="ltr"
              className="flex-1"
              aria-label={t("weight.customWeight")}
            />
            <span className="text-sm font-medium text-slate-500">
              {t("weight.kgUnit")}
            </span>
          </div>
        </label>

        {customExceeds && (
          <div className="rounded-xl bg-danger-soft border border-danger/20 px-4 py-3 text-sm text-danger">
            {t("weight.exceedsStock")}
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <span className="text-sm text-slate-500">{t("billing.subtotalCol")}</span>
          <span className="text-lg font-bold text-slate-900 tabular-nums" dir="ltr">
            {formatCurrency(customTotal, currency)}
          </span>
        </div>

        <p className="text-xs text-slate-400">
          {t("weight.available")}: {formatWeight(availableGrams)}
        </p>
      </div>
    </Modal>
  );
}
