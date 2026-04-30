import { db } from './schema';
import { createFinalizedBill } from '@/lib/services/billing-service';
import { createProductWithInitialMovement } from '@/lib/services/inventory-service';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import type { Product } from '@/types/domain';

export async function seedDemoData() {
  const existing = await db.products.count();
  if (existing > 0) {
    return { inserted: false };
  }

  const dateAdded = nowIso();
  const products: Product[] = [
    {
      id: createId('prod'),
      barcode: '1001001001',
      name: 'Milk 1L',
      category: 'Dairy',
      brand: 'Fresh Farm',
      unit: 'bottle',
      quantityInStock: 20,
      buyPrice: 1.1,
      sellPrice: 1.6,
      minimumStockAlert: 5,
      supplierName: 'Dairy Supplier',
      dateAdded,
      lastUpdated: dateAdded,
      shelfLocation: 'A-01',
      status: 'active',
    },
    {
      id: createId('prod'),
      barcode: '2002002002',
      name: 'Rice 5kg',
      category: 'Groceries',
      brand: 'Golden Grain',
      unit: 'bag',
      quantityInStock: 12,
      buyPrice: 4.2,
      sellPrice: 5.4,
      minimumStockAlert: 4,
      supplierName: 'Food Wholesale',
      dateAdded,
      lastUpdated: dateAdded,
      shelfLocation: 'B-04',
      status: 'active',
    },
    {
      id: createId('prod'),
      barcode: '3003003003',
      name: 'Chocolate Bar',
      category: 'Snacks',
      brand: 'Sweet Bite',
      unit: 'piece',
      quantityInStock: 35,
      buyPrice: 0.35,
      sellPrice: 0.75,
      minimumStockAlert: 10,
      supplierName: 'Snack Distributor',
      dateAdded,
      lastUpdated: dateAdded,
      shelfLocation: 'C-02',
      status: 'active',
    },
  ];

  for (const product of products) {
    await createProductWithInitialMovement(product);
  }

  await createFinalizedBill({
    items: [
      {
        productId: products[0].id,
        barcode: products[0].barcode,
        name: products[0].name,
        category: products[0].category,
        availableStock: products[0].quantityInStock,
        quantity: 2,
        unitBuyPrice: products[0].buyPrice,
        unitSellPrice: products[0].sellPrice,
      },
      {
        productId: products[2].id,
        barcode: products[2].barcode,
        name: products[2].name,
        category: products[2].category,
        availableStock: products[2].quantityInStock,
        quantity: 3,
        unitBuyPrice: products[2].buyPrice,
        unitSellPrice: products[2].sellPrice,
      },
    ],
    form: {
      cashierName: 'Owner',
      customerName: 'Walk-in Customer',
      customerPhone: '',
      paymentMethod: 'cash',
      discountAmount: 0,
      taxAmount: 0,
      paidAmount: 5.45,
      notes: 'Seed bill',
    },
  });

  return { inserted: true };
}
