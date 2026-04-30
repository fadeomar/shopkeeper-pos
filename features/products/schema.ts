import { z } from 'zod';

export const productSchema = z.object({
  barcode: z.string().trim().min(3, 'Barcode is required'),
  name: z.string().trim().min(2, 'Product name is required'),
  category: z.string().trim().min(2, 'Category is required'),
  brand: z.string().trim().optional(),
  unit: z.string().trim().min(1, 'Unit is required'),
  quantityInStock: z.coerce.number().min(0, 'Quantity cannot be negative'),
  buyPrice: z.coerce.number().min(0, 'Buy price cannot be negative'),
  sellPrice: z.coerce.number().min(0, 'Sell price cannot be negative'),
  minimumStockAlert: z.coerce.number().min(0, 'Minimum stock cannot be negative'),
  supplierName: z.string().trim().optional(),
  dateAdded: z.string().min(1, 'Date added is required'),
  expiryDate: z.string().optional(),
  shelfLocation: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']),
});

export type ProductSchema = z.infer<typeof productSchema>;
