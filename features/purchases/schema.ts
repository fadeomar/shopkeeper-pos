import { z } from 'zod';

export const purchaseFormSchema = z.object({
  cashierName: z.string().trim().optional(),
  supplierName: z.string().trim().optional(),
  supplierPhone: z.string().trim().optional(),
  paymentMethod: z.enum(['cash', 'card', 'mixed', 'credit']),
  discountAmount: z.coerce.number().min(0, 'Discount cannot be negative'),
  taxAmount: z.coerce.number().min(0, 'Tax cannot be negative'),
  paidAmount: z.coerce.number().min(0, 'Paid amount cannot be negative'),
  cashAmount: z.coerce.number().min(0, 'Cash amount cannot be negative').optional(),
  cardAmount: z.coerce.number().min(0, 'Card amount cannot be negative').optional(),
  notes: z.string().trim().optional(),
});

export type PurchaseFormSchema = z.infer<typeof purchaseFormSchema>;
