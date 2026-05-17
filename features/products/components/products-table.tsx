"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { formatCurrency } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/date";
import {
  adjustProductStock,
  updateProductDetails,
} from "@/lib/services/inventory-service";
import { settingsRepo } from "@/lib/db/repositories";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Modal } from "@/components/ui/modal";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/pos/price-display";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import type { Product, SyncStatus } from "@/types/domain";
import clsx from "clsx";
import type { ColumnDef } from "@tanstack/react-table";

function SyncBadge({ status }: { status?: SyncStatus }) {
  const { t } = useLocale();
  const effective = status ?? "synced";
  const styles: Record<SyncStatus, string> = {
    synced: "bg-green-50 text-green-700 border-green-100",
    pending: "bg-amber-50 text-amber-700 border-amber-100",
    syncing: "bg-blue-50 text-blue-700 border-blue-100",
    failed: "bg-red-50 text-red-700 border-red-100",
    conflict: "bg-amber-100 text-amber-800 border-amber-200",
    blocked: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap border",
        styles[effective],
      )}
    >
      {t(`sync.${effective}`)}
    </span>
  );
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
  const [mobilePage, setMobilePage] = useState(0);

  const mobilePageSize = 10;
  const mobilePageCount = Math.max(
    1,
    Math.ceil(filtered.length / mobilePageSize),
  );
  const mobilePageIndex = Math.min(mobilePage, mobilePageCount - 1);
  const mobileProducts = filtered.slice(
    mobilePageIndex * mobilePageSize,
    mobilePageIndex * mobilePageSize + mobilePageSize,
  );

  useEffect(() => {
    setMobilePage(0);
  }, [query, category]);

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

  if (!products)
    return (
      <Card>
        <p className="text-sm text-slate-500">
          {t("products.loadingProducts")}
        </p>
      </Card>
    );
  if (products.length === 0) {
    return (
      <EmptyState
        title={t("products.noProducts")}
        description={t("products.noProductsDesc")}
      />
    );
  }

  const columns: ColumnDef<Product>[] = [
    {
      header: t("products.barcode"),
      accessorKey: "barcode",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-slate-600">
          {row.original.barcode}
        </span>
      ),
    },
    {
      header: t("products.name"),
      accessorKey: "name",
      cell: ({ row }) => (
        <div>
          <span className="font-medium text-slate-800">
            {row.original.name}
          </span>
          {row.original.shelfLocation && (
            <div className="text-xs text-slate-400">
              {t("products.shelf")} {row.original.shelfLocation}
            </div>
          )}
        </div>
      ),
    },
    { header: t("products.category"), accessorKey: "category" },
    {
      header: t("products.qty"),
      accessorKey: "quantityInStock",
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {row.original.quantityInStock}
        </span>
      ),
    },
    {
      header: t("products.buy"),
      accessorKey: "buyPrice",
      cell: ({ row }) => (
        <PriceDisplay
          value={row.original.buyPrice}
          currency={currency}
          size="sm"
        />
      ),
    },
    {
      header: t("products.sell"),
      accessorKey: "sellPrice",
      cell: ({ row }) => (
        <PriceDisplay
          value={row.original.sellPrice}
          currency={currency}
          size="sm"
          emphasis
        />
      ),
    },
    { header: t("products.min"), accessorKey: "minimumStockAlert" },
    {
      header: t("products.supplier"),
      accessorKey: "supplierName",
      cell: ({ row }) => row.original.supplierName || "—",
    },
    {
      header: t("products.dateAdded"),
      accessorKey: "dateAdded",
      cell: ({ row }) => formatDate(row.original.dateAdded),
    },
    {
      header: t("products.status"),
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge tone={row.original.status === "active" ? "success" : "neutral"}>
          {t(`common.${row.original.status}` as Parameters<typeof t>[0])}
        </Badge>
      ),
    },
    {
      header: t("sync.status"),
      accessorKey: "syncStatus",
      cell: ({ row }) => <SyncBadge status={row.original.syncStatus} />,
    },
    {
      header: t("products.actions"),
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit?.(row.original)}
          >
            {t("common.edit")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdjustProduct(row.original);
              setAdjustQty("1");
            }}
          >
            {t("common.adjust")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => toggleStatus(row.original)}
          >
            {row.original.status === "active"
              ? t("common.deactivate")
              : t("common.activate")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card padding="sm">
        {/* Search & filter toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 mb-4">
          <Input
            className="flex-1 min-w-[200px]"
            placeholder={t("products.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SearchableSelect
            className="w-full sm:w-56"
            value={category}
            onValueChange={(value) => setCategory(value ?? "all")}
            options={categories.map((c) => ({
              value: c,
              label: c === "all" ? t("products.allCategories") : c,
            }))}
            placeholder={t("products.allCategories")}
            searchPlaceholder={t("products.searchPlaceholder")}
          />
        </div>

        <div className="grid gap-3 md:hidden">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              {t("products.noProducts")}
            </div>
          ) : (
            mobileProducts.map((product) => {
              const lowStock =
                settings?.lowStockHighlight &&
                product.quantityInStock <= product.minimumStockAlert;
              return (
                <div
                  key={product.id}
                  className={clsx(
                    "touch-card rounded-2xl border p-3 shadow-xs",
                    lowStock
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-white",
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
                    <div className="rounded-xl bg-white/75 p-2">
                      <p className="text-slate-500">{t("products.qty")}</p>
                      <p
                        className={clsx(
                          "font-black tabular-nums",
                          lowStock ? "text-amber-700" : "text-slate-900",
                        )}
                      >
                        {product.quantityInStock}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/75 p-2">
                      <p className="text-slate-500">{t("products.buy")}</p>
                      <p className="font-bold text-slate-800 tabular-nums">
                        {formatCurrency(product.buyPrice, currency)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/75 p-2">
                      <p className="text-slate-500">{t("products.sell")}</p>
                      <p className="font-bold text-slate-800 tabular-nums">
                        {formatCurrency(product.sellPrice, currency)}
                      </p>
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
          {filtered.length > mobilePageSize && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 md:hidden">
              <span>
                {mobilePageIndex + 1} / {mobilePageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMobilePage((page) => Math.max(page - 1, 0))}
                  disabled={mobilePageIndex === 0}
                >
                  {t("dataTable.previous")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setMobilePage((page) =>
                      Math.min(page + 1, mobilePageCount - 1),
                    )
                  }
                  disabled={mobilePageIndex >= mobilePageCount - 1}
                >
                  {t("dataTable.next")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="hidden md:block">
          <DataTable
            columns={columns}
            data={filtered}
            enableGlobalSearch={false}
            pageSize={25}
            emptyTitle={t("products.noProducts")}
            labels={{
              searchPlaceholder: t("dataTable.search"),
              loading: t("dataTable.loading"),
              page: t("dataTable.page"),
              of: t("dataTable.of"),
              rowsPerPage: t("dataTable.rowsPerPage"),
              first: t("dataTable.first"),
              previous: t("dataTable.previous"),
              next: t("dataTable.next"),
              last: t("dataTable.last"),
            }}
            getRowId={(product) => String(product.id)}
          />
        </div>
      </Card>

      {/* Adjust stock modal */}
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
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              {t("products.quantityChange")}
            </span>
            <Input
              type="number"
              step="1"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              {t("products.reasonNote")}
            </span>
            <Input
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
            />
          </label>
          {adjustProduct && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex flex-col gap-2">
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
