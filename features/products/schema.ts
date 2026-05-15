import { z } from 'zod';
import { normalizeBarcode } from '@/lib/utils/barcode';

export const productSchema = z.object({
  // Normalize barcode at the schema seam so the product form, quick-add modal,
  // and CSV import all save canonical values. "12345", " 12345 ", and "12 345"
  // all become "12345" before the min-length check runs.
  barcode: z.string().transform((v) => normalizeBarcode(v)).pipe(z.string().min(3, 'Barcode is required')),
  name: z.string().trim().min(2, 'Product name is required'),
  category: z.string().trim().min(2, 'Category is required'),
  brand: z.string().trim().optional(),
  unit: z.string().trim().min(1, 'Unit is required'),
  quantityInStock: z.coerce.number().int('Quantity must be a whole number').min(0, 'Quantity cannot be negative'),
  buyPrice: z.coerce.number().min(0, 'Buy price cannot be negative'),
  sellPrice: z.coerce.number().min(0, 'Sell price cannot be negative'),
  minimumStockAlert: z.coerce.number().int('Minimum stock must be a whole number').min(0, 'Minimum stock cannot be negative'),
  supplierName: z.string().trim().optional(),
  dateAdded: z.string().min(1, 'Date added is required'),
  expiryDate: z.string().optional(),
  shelfLocation: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']),
});

export type ProductSchema = z.infer<typeof productSchema>;
