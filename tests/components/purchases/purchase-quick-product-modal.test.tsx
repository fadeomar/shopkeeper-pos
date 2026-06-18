import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the firebase/config chain (permission/subscription/audit services) out
// of this component test — same approach as the inventory-service integration
// test. createProductWithInitialMovement then runs against fake-indexeddb only.
vi.mock("@/lib/services/permission-service", () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
  assertAppPermission: vi.fn().mockResolvedValue(undefined),
  getCurrentPermissions: vi.fn().mockResolvedValue({
    canVoid: true,
    canReturn: true,
    canDiscount: true,
    canViewProfit: true,
    canEditCost: true,
    canExport: true,
    canManageSettings: true,
    canManageRolePermissions: true,
  }),
}));
vi.mock("@/lib/services/subscription-service", () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/services/audit-service", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { LocaleProvider } from "@/components/providers/locale-context";
import { ToastProvider } from "@/components/ui/toast";
import { PurchaseQuickProductModal } from "@/features/purchases/components/purchase-quick-product-modal";
import { db } from "@/lib/db/schema";
import { resetTestDb } from "@/tests/helpers/db";
import type { Product } from "@/types/domain";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof PurchaseQuickProductModal>> = {},
) {
  const props = {
    open: true,
    barcode: "3003003001",
    currency: "ILS",
    defaultQuantity: 100,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    onUseExisting: vi.fn(),
    ...overrides,
  };
  const result = render(
    <LocaleProvider>
      <ToastProvider>
        <PurchaseQuickProductModal {...props} />
      </ToastProvider>
    </LocaleProvider>,
  );
  return { ...result, props };
}

describe("PurchaseQuickProductModal — weight products", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a weight product (saleType=weight, kg threshold persisted as grams) and passes the kg purchase quantity", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderModal({ onCreated });

    // Switch the selling method from Piece to Weight.
    await user.click(screen.getByRole("button", { name: "Weight" }));

    const setInput = async (name: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!input) throw new Error(`input[name="${name}"] not found`);
      await user.clear(input);
      await user.type(input, value);
    };

    await setInput("name", "سكر");
    // Weight products require a per-kg sell price > 0.
    await setInput("sellPrice", "5");
    // Low-stock threshold is entered in kg.
    await setInput("minimumStockAlert", "2");

    await user.click(screen.getByRole("button", { name: /save and add/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    const [createdProduct, quantity] = onCreated.mock.calls[0] as [Product, number];
    expect(createdProduct.saleType).toBe("weight");
    // Purchase quantity flows through as kilograms (not truncated to pieces).
    expect(quantity).toBe(100);

    const stored = await db.products.get(createdProduct.id);
    expect(stored?.saleType).toBe("weight");
    // 2 kg threshold persisted as 2000 grams, matching the main product form.
    expect(stored?.minimumStockAlert).toBe(2000);
    // Initial stock is always 0 — the purchase movement adds it.
    expect(stored?.quantityInStock).toBe(0);
  });

  it("creates a piece product with a whole-number quantity by default", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderModal({ onCreated, defaultQuantity: 3 });

    // Click the (default) Piece toggle first so the modal's open-effect form
    // reset — which fires once the async settings query resolves — happens
    // before we type, otherwise it would wipe the typed name.
    await user.click(screen.getByRole("button", { name: "Piece" }));

    const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
    if (!nameInput) throw new Error('input[name="name"] not found');
    await user.clear(nameInput);
    await user.type(nameInput, "Pen");

    await user.click(screen.getByRole("button", { name: /save and add/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const [createdProduct, quantity] = onCreated.mock.calls[0] as [Product, number];
    expect(createdProduct.saleType).toBe("unit");
    expect(quantity).toBe(3);
  });
});
