"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { countProductStock } from "@/lib/services/inventory-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { SectionCard } from "@/components/ui/section-card";
import { TableShell } from "@/components/ui/table-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { StockBadge } from "@/components/pos/stock-badge";
import { PriceDisplay } from "@/components/pos/price-display";
import {
  actionRowClasses,
  buttonSizes,
  buttonVariants,
  panelTones,
  typographyClasses,
} from "@/lib/design/variants";
import type { Product, StockMovement } from "@/types/domain";

/* eslint-disable @typescript-eslint/consistent-type-definitions */
type InventoryModalMode = "count" | null;

const EXPIRY_WINDOW_DAYS = 30;

function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function productLabel(product: Product): string {
  return `${product.name} (${product.barcode})`;
}

export function InventoryWorkspace() {
  const { t } = useLocale();
  const { push } = useToast();
  const products = useLiveQuery(
    () => db.products.orderBy("name").toArray(),
    [],
  );
  const movements = useLiveQuery(
    () => db.stockMovements.orderBy("createdAt").reverse().limit(75).toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);

  const [mode, setMode] = useState<InventoryModalMode>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // buyPrice + supplierName were used by the legacy "Receive stock" modal.
  // Stock receiving is now done through /purchases/new where supplier and
  // multi-line cost tracking are first-class. These two pieces of local
  // state are kept as stubs only to avoid widening the diff on every other
  // bit of state in this file.
  const buyPrice = "";
  const supplierName = "";
  void buyPrice;
  void supplierName;

  const activeProducts = useMemo(
    () => (products ?? []).filter((product) => product.status === "active"),
    [products],
  );

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    (products ?? []).forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const lowStockProducts = activeProducts.filter(
    (product) =>
      product.quantityInStock > 0 &&
      product.quantityInStock <= product.minimumStockAlert,
  );
  const outOfStockProducts = activeProducts.filter(
    (product) => product.quantityInStock <= 0,
  );
  const expiringProducts = activeProducts
    .filter((product) => {
      if (!product.expiryDate) return false;
      const days = daysUntil(product.expiryDate);
      return days >= 0 && days <= EXPIRY_WINDOW_DAYS;
    })
    .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));

  const currency = settings?.currency ?? "USD";
  const stockValue = activeProducts.reduce(
    (sum, product) => sum + product.quantityInStock * product.buyPrice,
    0,
  );
  const retailValue = activeProducts.reduce(
    (sum, product) => sum + product.quantityInStock * product.sellPrice,
    0,
  );

  function openModal(
    nextMode: Exclude<InventoryModalMode, null>,
    product?: Product,
  ) {
    setMode(nextMode);
    setSelectedProductId(product?.id ?? activeProducts[0]?.id ?? "");
    setQuantity(
      nextMode === "count" && product ? String(product.quantityInStock) : "",
    );
    setNote("");
  }

  function closeModal() {
    if (submitting) return;
    setMode(null);
  }

  async function submitInventoryAction() {
    const product = activeProducts.find(
      (item) => item.id === selectedProductId,
    );
    const parsedQuantity = Number(quantity);

    if (!product) {
      push(t("inventory.selectProductFirst"));
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
      push(t("inventory.invalidQuantity"));
      return;
    }

    try {
      setSubmitting(true);
      if (mode === "count") {
        await countProductStock(product, parsedQuantity, note);
        push(t("inventory.stockCountSaved"));
      }
      setMode(null);
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("inventory.actionFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProduct = activeProducts.find(
    (product) => product.id === selectedProductId,
  );
  const countedDifference =
    selectedProduct && mode === "count" && quantity.trim()
      ? Number(quantity) - selectedProduct.quantityInStock
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className={actionRowClasses.end}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => openModal("count")}
        >
          {t("inventory.stockCount")}
        </Button>
        <Link
          href={"/purchases/new" as never}
          className={clsx(
            "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors duration-150",
            buttonSizes.md,
            buttonVariants.primary,
          )}
        >
          {t("purchases.newPurchase")}
        </Link>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t("inventory.lowStock")}
          value={lowStockProducts.length}
        />
        <StatCard
          label={t("inventory.outOfStock")}
          value={outOfStockProducts.length}
        />
        <StatCard
          label={t("inventory.expiringSoon")}
          value={expiringProducts.length}
        />
        <StatCard
          label={t("inventory.stockCostValue")}
          value={
            <PriceDisplay
              value={stockValue}
              currency={currency}
              size="xl"
              emphasis
            />
          }
          helper={
            <PriceDisplay value={retailValue} currency={currency} size="sm" />
          }
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <InventoryListCard
          title={t("inventory.lowStock")}
          emptyText={t("inventory.noLowStock")}
          products={lowStockProducts}
          actionLabel={t("purchases.newPurchase")}
          onAction={() => {
            window.location.href = "/purchases/new";
          }}
        />
        <InventoryListCard
          title={t("inventory.outOfStock")}
          emptyText={t("inventory.noOutOfStock")}
          products={outOfStockProducts}
          actionLabel={t("purchases.newPurchase")}
          onAction={() => {
            window.location.href = "/purchases/new";
          }}
        />
        <InventoryListCard
          title={t("inventory.expiringSoon")}
          emptyText={t("inventory.noExpiringSoon")}
          products={expiringProducts}
          actionLabel={t("inventory.count")}
          onAction={(product) => openModal("count", product)}
          renderMeta={(product) =>
            `${t("inventory.expires")}: ${product.expiryDate}`
          }
        />
      </section>

      <TableShell
        title={t("inventory.movementHistory")}
        description={t("inventory.movementHistoryDesc")}
        loading={movements === undefined}
        empty={
          movements !== undefined && movements.length === 0 ? (
            <EmptyState compact title={t("inventory.noMovements")} />
          ) : undefined
        }
      >
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead>
            <tr>
              <th className={typographyClasses.tableHeader}>
                {t("inventory.date")}
              </th>
              <th className={typographyClasses.tableHeader}>
                {t("inventory.product")}
              </th>
              <th className={typographyClasses.tableHeader}>
                {t("inventory.type")}
              </th>
              <th className={clsx(typographyClasses.tableHeader, "text-end")}>
                {t("inventory.change")}
              </th>
              <th className={typographyClasses.tableHeader}>
                {t("inventory.note")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(movements ?? []).map((movement) => (
              <MovementRow
                key={movement.id}
                movement={movement}
                product={productsById.get(movement.productId)}
              />
            ))}
          </tbody>
        </table>
      </TableShell>

      <Modal
        open={mode !== null}
        title={t("inventory.stockCount")}
        description={t("inventory.stockCountDesc")}
        onClose={closeModal}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={closeModal}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={submitInventoryAction}
              disabled={submitting || !activeProducts.length}
              loading={submitting}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField label={t("inventory.product")}>
            <Select
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
            >
              {activeProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {productLabel(product)}
                </option>
              ))}
            </Select>
          </FormField>

          {selectedProduct && (
            <div
              className={clsx(
                "rounded-xl border px-3 py-2 text-sm",
                panelTones.neutral,
              )}
            >
              {t("inventory.currentStock")}:{" "}
              <strong>{selectedProduct.quantityInStock}</strong>
              {Number.isFinite(countedDifference) && quantity.trim() && (
                <span className="ms-3">
                  {t("inventory.difference")}:{" "}
                  <strong>
                    {countedDifference > 0 ? "+" : ""}
                    {countedDifference}
                  </strong>
                </span>
              )}
            </div>
          )}

          <FormField label={t("inventory.countedQuantity")}>
            <Input
              type="number"
              min={0}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </FormField>

          <FormField label={t("inventory.note")}>
            <Input
              value={note}
              placeholder={t("inventory.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
}) {
  return (
    <SectionCard padding="md" className="min-h-full">
      <div className="flex flex-col gap-1.5">
        <p className={typographyClasses.statLabel}>{label}</p>
        <div className={typographyClasses.statValue}>{value}</div>
        {helper && <div className={typographyClasses.statHelper}>{helper}</div>}
      </div>
    </SectionCard>
  );
}

function InventoryListCard({
  title,
  emptyText,
  products,
  actionLabel,
  onAction,
  renderMeta,
}: {
  title: string;
  emptyText: string;
  products: Product[];
  actionLabel: string;
  onAction: (product: Product) => void;
  renderMeta?: (product: Product) => string;
}) {
  return (
    <SectionCard
      title={title}
      padding="md"
      className="flex min-h-[260px] flex-col"
    >
      {products.length === 0 && <EmptyState compact title={emptyText} />}
      <div className="flex flex-col divide-y divide-slate-100">
        {products.slice(0, 8).map((product) => (
          <div
            key={product.id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">
                {product.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StockBadge
                  quantity={product.quantityInStock}
                  minQuantity={product.minimumStockAlert}
                  size="sm"
                />
                {renderMeta ? (
                  <span className={typographyClasses.hint}>
                    {renderMeta(product)}
                  </span>
                ) : (
                  <span className={typographyClasses.hint}>
                    {product.quantityInStock} / {product.minimumStockAlert}
                  </span>
                )}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onAction(product)}
            >
              {actionLabel}
            </Button>
          </div>
        ))}
      </div>
      {products.length > 8 && (
        <p className={typographyClasses.hint}>+{products.length - 8}</p>
      )}
    </SectionCard>
  );
}

function MovementRow({
  movement,
  product,
}: {
  movement: StockMovement;
  product?: Product;
}) {
  const { t } = useLocale();
  const isPositive = movement.quantityChange >= 0;

  return (
    <tr className="align-top hover:bg-slate-50/60">
      <td
        className={clsx(typographyClasses.tableCellMuted, "whitespace-nowrap")}
      >
        {formatDateTime(movement.createdAt)}
      </td>
      <td className={typographyClasses.tableCellStrong}>
        {product?.name ?? t("inventory.unknownProduct")}
      </td>
      <td className={typographyClasses.tableCell}>
        <Badge tone="neutral" size="sm">
          {movement.movementType}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-end">
        <Badge tone={isPositive ? "success" : "danger"} size="sm">
          {isPositive ? "+" : ""}
          {movement.quantityChange}
        </Badge>
      </td>
      <td className={clsx(typographyClasses.tableCellMuted, "min-w-[220px]")}>
        {movement.note || movement.referenceType}
      </td>
    </tr>
  );
}
