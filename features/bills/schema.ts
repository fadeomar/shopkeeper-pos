import { z } from 'zod';

export const billFormSchema = z.object({
  cashierName: z.string().trim().optional(),
  customerName: z.string().trim().optional(),
  customerPhone: z.string().trim().optional(),
  paymentMethod: z.enum(['cash', 'card', 'mixed', 'credit']),
  discountAmount: z.coerce.number().min(0, 'Discount cannot be negative'),
  taxAmount: z.coerce.number().min(0, 'Tax cannot be negative'),
  // For 'cash'/'credit' methods, paidAmount is cash tendered / cash deposit.
  // For 'card', paidAmount is ignored (set to totalAmount in the service).
  // For 'mixed', paidAmount is ignored — use cashAmount + cardAmount instead.
  paidAmount: z.coerce.number().min(0, 'Paid amount cannot be negative'),
  cashAmount: z.coerce.number().min(0, 'Cash amount cannot be negative').optional(),
  cardAmount: z.coerce.number().min(0, 'Card amount cannot be negative').optional(),
  notes: z.string().trim().optional(),
});

export type BillFormSchema = z.infer<typeof billFormSchema>;
