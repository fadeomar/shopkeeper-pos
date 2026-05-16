"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { formatDate } from "@/lib/utils/date";
import {
  adjustProductStock,
  updateProductDetails,
} from "@/lib/services/inventory-service";
import { settingsRepo } from "@/lib/db/repositories";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { TableShell } from "@/components/ui/table-shell";
import { Toolbar } from "@/components/ui/toolbar";
import { FormField } from "@/components/ui/form-field";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusPill } from "@/components/ui/status-pill";
import { PriceDisplay } from "@/components/pos/price-display";
import { StockBadge } from "@/components/pos/stock-badge";
import { SyncIndicator } from "@/components/pos/sync-indicator";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import type { Product, SyncStatus } from "@/types/domain";
import {
  mobileCardClasses,
  panelTones,
  typographyClasses,
} from "@/lib/design/variants";
import clsx from "clsx";

function SyncBadge({ status }: { status?: SyncStatus }) {
  const { t } = useLocale();
  const effective = status ?? "synced";
  return <SyncIndicator status={effective} label={t(`sync.${effective}`)} />;
}

export function ProductsTable({
  onEdit,
}: {
  onEdit?: (product: Product) => void;
}) {
  const { t } = useLocale();
  const products = useLiveQuery(
    () => db.products.orderBy("name").toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();
  const currency = settings?.currency ?? "USD";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState("1");
  const [adjustNote, setAdjustNote] = useState("Manual stock adjustment");

  const categories = useMemo(() => {
    const set = new Set((products ?? []).map((p) => p.category));
    return ["all", ...Array.from(set)];
  }, [products]);

  const filtered = useMemo(() => {
    return (products ?? []).filter((p) => {
      const matchQ = [p.name, p.barcode, p.brand, p.supplierName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchC = category === "all" || p.category === category;
      return matchQ && matchC;
    });
  }, [products, query, category]);

  async function toggleStatus(product: Product) {
    const newStatus = product.status === "active" ? "inactive" : "active";
    await updateProductDetails(product, { status: newStatus });
    push(
      product.status === "active"
        ? t("products.productDeactivated")
        : t("products.productActivated"),
    );
  }

  async function submitAdjustment() {
    if (!adjustProduct) return;
    const qty = Number(adjustQty);
    if (Number.isNaN(qty) || qty === 0) {
      push(t("products.nonZeroAdj"), "error");
      return;
    }
    try {
      await adjustProductStock(
        adjustProduct,
        qty,
        adjustNote || "Manual stock adjustment",
      );
      push(t("products.stockAdjusted"));
      setAdjustProduct(null);
      setAdjustQty("1");
      setAdjustNote("Manual stock adjustment");
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("products.adjustFailed"),
        "error",
      );
    }
  }

  if (!products) {
    return <LoadingState title={t("products.loadingProducts")} />;
  }

  if (products.length === 0) {
    return (
      <EmptyState
        title={t("products.noProducts")}
        description={t("products.noProductsDesc")}
      />
    );
  }

  const headers = [
    t("products.barcode"),
    t("products.name"),
    t("products.category"),
    t("products.qty"),
    t("products.buy"),
    t("products.sell"),
    t("products.min"),
    t("products.supplier"),
    t("products.dateAdded"),
    t("products.status"),
    t("sync.status"),
    t("products.actions"),
  ];

  const toolbar = (
    <Toolbar className="grid w-full grid-cols-1 sm:grid-cols-[minmax(220px,1fr)_auto] sm:items-center">
      <Input
        placeholder={t("products.searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Select
        className="sm:w-48"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        {categories.map((c) => (
          <option key={c} value={c}>
            {c === "all" ? t("products.allCategories") : c}
          </option>
        ))}
      </Select>
    </Toolbar>
  );

  return (
    <>
      <TableShell toolbar={toolbar}>
        <div className="grid gap-3 p-4 md:hidden">
          {filtered.length === 0 ? (
            <EmptyState compact title={t("products.noProducts")} />
          ) : (
            filtered.map((product) => {
              const lowStock =
                settings?.lowStockHighlight &&
                product.quantityInStock <= product.minimumStockAlert;
              return (
                <div
                  key={product.id}
                  className={clsx(
                    "touch-card",
                    mobileCardClasses.item,
                    lowStock && "border-amber-200 bg-amber-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">
                        {product.name}
                      </p>
                      <p className="text-xs text-slate-500 font-mono truncate">
                        {product.barcode}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 truncate">
                        {product.category}
                        {product.supplierName
                          ? ` · ${product.supplierName}`
                          : ""}
                      </p>
                    </div>
                    <SyncBadge status={product.syncStatus} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div
                      className={clsx(
                        "rounded-xl border p-2",
                        panelTones.neutral,
                      )}
                    >
                      <p className="text-slate-500">{t("products.qty")}</p>
                      <p
                        className={clsx(
                          "font-black tabular-nums",
                          lowStock ? "text-amber-700" : "text-slate-900",
                        )}
                      >
                        {product.quantityInStock}
                      </p>
                      <div className="mt-1">
                        <StockBadge
                          quantity={product.quantityInStock}
                          minQuantity={product.minimumStockAlert}
                        />
                      </div>
                    </div>
                    <div
                      className={clsx(
                        "rounded-xl border p-2",
                        panelTones.neutral,
                      )}
                    >
                      <p className="text-slate-500">{t("products.buy")}</p>
                      <PriceDisplay
                        value={product.buyPrice}
                        currency={currency}
                      />
                    </div>
                    <div
                      className={clsx(
                        "rounded-xl border p-2",
                        panelTones.neutral,
                      )}
                    >
                      <p className="text-slate-500">{t("products.sell")}</p>
                      <PriceDisplay
                        value={product.sellPrice}
                        currency={currency}
                        emphasis
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit?.(product)}
                    >
                      {t("common.edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAdjustProduct(product);
                        setAdjustQty("1");
                      }}
                    >
                      {t("common.adjust")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleStatus(product)}
                    >
                      {product.status === "active"
                        ? t("common.deactivate")
                        : t("common.activate")}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden md:block">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                {headers.map((h) => (
                  <th key={h} className={typographyClasses.tableHeader}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="px-3 py-8">
                    <EmptyState compact title={t("products.noProducts")} />
                  </td>
                </tr>
              ) : (
                filtered.map((product) => {
                  const lowStock =
                    settings?.lowStockHighlight &&
                    product.quantityInStock <= product.minimumStockAlert;
                  return (
                    <tr
                      key={product.id}
                      className={clsx(
                        "transition-colors",
                        lowStock ? "bg-amber-50/70" : "hover:bg-slate-50/60",
                      )}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                        {product.barcode}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-slate-800">
                          {product.name}
                        </span>
                        {product.shelfLocation && (
                          <div className="text-xs text-slate-400">
                            {t("products.shelf")} {product.shelfLocation}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {product.category}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          <span
                            className={clsx(
                              "tabular-nums font-semibold",
                              lowStock ? "text-amber-700" : "text-slate-700",
                            )}
                          >
                            {product.quantityInStock}
                          </span>
                          <StockBadge
                            quantity={product.quantityInStock}
                            minQuantity={product.minimumStockAlert}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <PriceDisplay
                          value={product.buyPrice}
                          currency={currency}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <PriceDisplay
                          value={product.sellPrice}
                          currency={currency}
                          emphasis
                        />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-500">
                        {product.minimumStockAlert}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 max-w-[120px] truncate">
                        {product.supplierName || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                        {formatDate(product.dateAdded)}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill
                          status={product.status}
                          tone={
                            product.status === "active" ? "success" : "neutral"
                          }
                          label={t(
                            `common.${product.status}` as Parameters<
                              typeof t
                            >[0],
                          )}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <SyncBadge status={product.syncStatus} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit?.(product)}
                          >
                            {t("common.edit")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAdjustProduct(product);
                              setAdjustQty("1");
                            }}
                          >
                            {t("common.adjust")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleStatus(product)}
                          >
                            {product.status === "active"
                              ? t("common.deactivate")
                              : t("common.activate")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </TableShell>

      <Modal
        open={Boolean(adjustProduct)}
        title={
          adjustProduct
            ? `${t("products.stockAdjustTitle")}: ${adjustProduct.name}`
            : t("products.stockAdjustTitle")
        }
        description={
          adjustProduct
            ? t("products.stockAdjustDesc", {
                count: adjustProduct.quantityInStock,
              })
            : undefined
        }
        onClose={() => setAdjustProduct(null)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAdjustProduct(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={submitAdjustment}>
              {t("common.saveAdjustment")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField label={t("products.quantityChange")}>
            <Input
              type="number"
              step="1"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
            />
          </FormField>
          <FormField label={t("products.reasonNote")}>
            <Input
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
            />
          </FormField>
          {adjustProduct && (
            <div
              className={clsx(
                "flex flex-col gap-2 rounded-xl border px-4 py-3",
                panelTones.neutral,
              )}
            >
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">
                  {t("products.currentStock")}
                </span>
                <span className="font-semibold text-slate-800">
                  {adjustProduct.quantityInStock}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">
                  {t("products.resultingStock")}
                </span>
                <span
                  className={clsx(
                    "font-bold",
                    adjustProduct.quantityInStock + (Number(adjustQty) || 0) >=
                      0
                      ? "text-green-700"
                      : "text-red-600",
                  )}
                >
                  {adjustProduct.quantityInStock + (Number(adjustQty) || 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
