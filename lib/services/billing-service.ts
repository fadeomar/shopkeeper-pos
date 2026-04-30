import { db } from "@/lib/db/schema";
import { SETTINGS_ID, settingsRepo } from "@/lib/db/repositories";
import {
  calculateBillTotals,
  calculateChange,
  calculateLineProfit,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { nowIso } from "@/lib/utils/date";
import { createBillNumber, createId } from "@/lib/utils/id";
import type {
  Bill,
  BillDraftItem,
  BillFormValues,
  BillItem,
  Product,
  Settings,
  StockMovement,
} from "@/types/domain";

function validateDraftLine(
  settings: Settings,
  line: BillDraftItem,
  product: Product,
) {
  if (product.status !== "active")
    throw new Error(`Product ${product.name} is inactive.`);
  if (line.quantity <= 0)
    throw new Error(`Quantity for ${product.name} must be greater than zero.`);
  if (line.quantity > product.quantityInStock)
    throw new Error(`Not enough stock for ${product.name}.`);
  if (!settings.allowLossSale && line.unitSellPrice < line.unitBuyPrice) {
    throw new Error(`Loss-making sale is not allowed for ${product.name}.`);
  }
}

export async function createFinalizedBill(input: {
  items: BillDraftItem[];
  form: BillFormValues;
}): Promise<Bill> {
  if (input.items.length === 0) {
    throw new Error("Add at least one product before finalizing the bill.");
  }

  const totalAmountPreview = calculateBillTotals(
    input.items.map((item) => ({
      quantity: item.quantity,
      unitBuyPrice: item.unitBuyPrice,
      unitSellPrice: item.unitSellPrice,
    })),
    input.form.discountAmount,
    input.form.taxAmount,
  ).totalAmount;

  if (calculateChange(input.form.paidAmount, totalAmountPreview) < 0) {
    throw new Error("Paid amount is lower than bill total.");
  }

  return db.transaction(
    "rw",
    [db.bills, db.billItems, db.products, db.stockMovements, db.settings],
    async () => {
      const settings = await db.settings.get(SETTINGS_ID);
      if (!settings) {
        throw new Error(
          "Settings row not found. Initialize settings before creating bills.",
        );
      }
      const productIds = input.items.map((item) => item.productId);
      const liveProducts = await db.products.bulkGet(productIds);

      if (liveProducts.some((product) => !product)) {
        throw new Error("Some products could not be found in inventory.");
      }

      const createdAt = nowIso();
      const sequence = settings.nextBillSequence;
      const billId = createId("bill");
      const billNumber = createBillNumber(sequence);
      const products = liveProducts as Product[];

      for (const line of input.items) {
        const product = products.find(
          (candidate) => candidate.id === line.productId,
        );
        if (!product) throw new Error(`Product ${line.name} not found.`);
        validateDraftLine(settings, line, product);
      }

      const billItems: BillItem[] = input.items.map((item) => ({
        id: createId("bill_item"),
        billId,
        originalProductId: item.productId,
        barcodeAtSale: item.barcode,
        productNameAtSale: item.name,
        categoryAtSale: item.category,
        quantitySold: item.quantity,
        unitBuyPriceAtSale: item.unitBuyPrice,
        unitSellPriceAtSale: item.unitSellPrice,
        lineSubtotal: calculateLineSubtotal(item.quantity, item.unitSellPrice),
        lineProfit: calculateLineProfit(
          item.quantity,
          item.unitBuyPrice,
          item.unitSellPrice,
        ),
        createdAt,
      }));

      const totals = calculateBillTotals(
        input.items.map((item) => ({
          quantity: item.quantity,
          unitBuyPrice: item.unitBuyPrice,
          unitSellPrice: item.unitSellPrice,
        })),
        input.form.discountAmount,
        input.form.taxAmount,
      );

      const totalAmount = totals.totalAmount;
      const changeAmount = calculateChange(input.form.paidAmount, totalAmount);

      const bill: Bill = {
        id: billId,
        billNumber,
        createdAt,
        cashierName: input.form.cashierName,
        customerName: input.form.customerName,
        customerPhone: input.form.customerPhone,
        paymentMethod: input.form.paymentMethod,
        subtotal: totals.subtotal,
        discountAmount: input.form.discountAmount,
        taxAmount: input.form.taxAmount,
        totalAmount,
        paidAmount: input.form.paidAmount,
        changeAmount,
        totalProfit: totals.totalProfit,
        itemCount: input.items.reduce((sum, item) => sum + item.quantity, 0),
        status: "finalized",
        notes: input.form.notes,
      };

      const updatedProducts: Product[] = products.map((product) => {
        const soldLines = input.items.filter(
          (item) => item.productId === product.id,
        );
        if (soldLines.length === 0) return product;

        const totalSold = soldLines.reduce(
          (sum, line) => sum + line.quantity,
          0,
        );
        return {
          ...product,
          quantityInStock: product.quantityInStock - totalSold,
          lastUpdated: createdAt,
        };
      });

      const stockMovements: StockMovement[] = input.items.map((item) => ({
        id: createId("move"),
        productId: item.productId,
        movementType: "sale",
        quantityChange: -item.quantity,
        referenceType: "bill",
        referenceId: billId,
        note: `Sale recorded in ${billNumber}`,
        createdAt,
      }));

      await db.bills.add(bill);
      await db.billItems.bulkAdd(billItems);
      await db.products.bulkPut(updatedProducts);
      await db.stockMovements.bulkAdd(stockMovements);
      await db.settings.update(settings.id, {
        nextBillSequence: sequence + 1,
        updatedAt: createdAt,
      });

      return bill;
    },
  );
}
