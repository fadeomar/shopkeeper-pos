import type { Product, Settings } from "@/types/domain";

/**
 * The stock level at or below which a product counts as "low".
 *
 * A product's own `minimumStockAlert` wins when it is explicitly set (> 0).
 * Otherwise we fall back to the store-wide `lowStockThreshold` setting so the
 * global default actually drives behaviour for products that were never given
 * a per-item alert level (the form defaults it to 0).
 */
export function lowStockLimit(
  product: Pick<Product, "minimumStockAlert">,
  settings?: Pick<Settings, "lowStockThreshold"> | null,
): number {
  if (product.minimumStockAlert && product.minimumStockAlert > 0) {
    return product.minimumStockAlert;
  }
  return settings?.lowStockThreshold ?? 0;
}

/** True when the product is in stock but at/below its effective low-stock limit. */
export function isLowStock(
  product: Pick<Product, "quantityInStock" | "minimumStockAlert">,
  settings?: Pick<Settings, "lowStockThreshold"> | null,
): boolean {
  return product.quantityInStock <= lowStockLimit(product, settings);
}
