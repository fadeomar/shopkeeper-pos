"use client";

import { useMemo, useRef, useState } from "react";
import { db } from "@/lib/db/schema";
import {
  importProductsFromPreview,
  previewProductCsvImport,
  type ProductImportPreview,
} from "@/lib/services/product-import-service";
import {
  createProductImportTemplateCsv,
  productsToCsv,
} from "@/lib/utils/product-csv";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Toolbar } from "@/components/ui/toolbar";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { alertTones, panelTones } from "@/lib/design/variants";
import clsx from "clsx";

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ProductImportExport() {
  const { t } = useLocale();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const previewStats = useMemo(() => {
    if (!preview) return null;
    return [
      {
        label: t("products.rowsValid"),
        value: preview.validRows.length,
        tone: "success",
      },
      {
        label: t("products.rowsInvalid"),
        value: preview.errors.length,
        tone: preview.errors.length ? "error" : "muted",
      },
      {
        label: t("products.rowsTotal"),
        value: preview.totalRows,
        tone: "muted",
      },
    ];
  }, [preview, t]);

  function resetImport() {
    setPreview(null);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function downloadTemplate() {
    downloadTextFile(
      "shopkeeper-products-template.csv",
      createProductImportTemplateCsv(),
    );
    push(t("products.templateDownloaded"));
  }

  async function exportProducts() {
    const products = await db.products.orderBy("name").toArray();
    if (products.length === 0) {
      push(t("products.noProductsToExport"), "error");
      return;
    }
    downloadTextFile(
      `shopkeeper-products-${new Date().toISOString().slice(0, 10)}.csv`,
      productsToCsv(products),
    );
    push(t("products.productsExported", { count: products.length }));
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      push(t("products.csvOnly"), "error");
      resetImport();
      return;
    }

    setIsReading(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      const nextPreview = await previewProductCsvImport(text);
      setPreview(nextPreview);
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("products.importFailed"),
        "error",
      );
      resetImport();
    } finally {
      setIsReading(false);
    }
  }

  async function runImport() {
    if (!preview || preview.validRows.length === 0) return;
    setIsImporting(true);
    try {
      const result = await importProductsFromPreview(preview);
      push(t("products.importDone", { count: result.importedCount }));
      resetImport();
      setOpen(false);
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("products.importFailed"),
        "error",
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <SectionCard
        title={t("products.importExportTitle")}
        description={t("products.importExportDesc")}
        padding="sm"
        actions={
          <Toolbar align="end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
            >
              {t("products.downloadTemplate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportProducts}
            >
              {t("products.exportProducts")}
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(true)}>
              {t("products.importProducts")}
            </Button>
          </Toolbar>
        }
      >
        <span className="sr-only">{t("products.importExportTitle")}</span>
      </SectionCard>

      <Modal
        open={open}
        title={t("products.importProducts")}
        description={t("products.importProductsDesc")}
        onClose={() => {
          setOpen(false);
          resetImport();
        }}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                resetImport();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={
                !preview ||
                preview.validRows.length === 0 ||
                isImporting ||
                isReading
              }
              onClick={runImport}
            >
              {isImporting
                ? t("products.importing")
                : t("products.importReadyButton")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <p className="text-sm font-medium text-slate-700">
              {fileName || t("products.noCsvSelected")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("products.importProductsHelp")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => inputRef.current?.click()}
              disabled={isReading || isImporting}
            >
              {isReading ? t("products.readingFile") : t("products.chooseCsv")}
            </Button>
          </div>

          {previewStats && (
            <div className="grid grid-cols-3 gap-2">
              {previewStats.map((stat) => (
                <div
                  key={stat.label}
                  className={clsx(
                    "rounded-xl border px-3 py-2 text-center",
                    panelTones.neutral,
                  )}
                >
                  <div className="flex justify-center">
                    <Badge
                      tone={
                        stat.tone === "success"
                          ? "success"
                          : stat.tone === "error"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {stat.value}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {preview && preview.validRows.length > 0 && (
            <div
              className={clsx(
                "rounded-xl border px-4 py-3 text-sm",
                alertTones.success,
              )}
            >
              {t("products.importReady", { count: preview.validRows.length })}
            </div>
          )}

          {preview && preview.errors.length > 0 && (
            <div
              className={clsx("rounded-xl border px-4 py-3", alertTones.danger)}
            >
              <p className="text-sm font-semibold">
                {t("products.importErrors")}
              </p>
              <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto text-xs">
                {preview.errors.slice(0, 20).map((error, index) => (
                  <li
                    key={`${error.rowNumber}-${error.barcode ?? ""}-${index}`}
                  >
                    {error.rowNumber > 0
                      ? t("products.importRowError", { row: error.rowNumber })
                      : t("products.importFileError")}
                    {error.barcode ? ` (${error.barcode})` : ""}:{" "}
                    {error.message}
                  </li>
                ))}
                {preview.errors.length > 20 && (
                  <li>
                    {t("products.moreImportErrors", {
                      count: preview.errors.length - 20,
                    })}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
