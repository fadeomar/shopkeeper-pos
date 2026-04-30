import { z } from 'zod';

export const billFormSchema = z.object({
  cashierName: z.string().trim().optional(),
  customerName: z.string().trim().optional(),
  customerPhone: z.string().trim().optional(),
  paymentMethod: z.enum(['cash', 'card', 'mixed', 'credit']),
  discountAmount: z.coerce.number().min(0, 'Discount cannot be negative'),
  taxAmount: z.coerce.number().min(0, 'Tax cannot be negative'),
  paidAmount: z.coerce.number().min(0, 'Paid amount cannot be negative'),
  notes: z.string().trim().optional(),
});

export type BillFormSchema = z.infer<typeof billFormSchema>;
