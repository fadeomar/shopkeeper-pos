import { addMoney, allocateMoney, multiplyMoney, roundMoney, subtractMoney } from './money';

export function calculateLineSubtotal(quantity: number, unitSellPrice: number) {
  return multiplyMoney(unitSellPrice, quantity);
}

export function calculateLineGrossProfit(quantity: number, unitBuyPrice: number, unitSellPrice: number) {
  return multiplyMoney(subtractMoney(unitSellPrice, unitBuyPrice), quantity);
}

export function calculateLineProfit(quantity: number, unitBuyPrice: number, unitSellPrice: number) {
  return calculateLineGrossProfit(quantity, unitBuyPrice, unitSellPrice);
}

export function calculateBillTotals(
  lines: Array<{ quantity: number; unitBuyPrice: number; unitSellPrice: number }>,
  discountAmount: number,
  taxAmount: number,
) {
  const subtotal = lines.reduce(
    (sum, line) => addMoney(sum, calculateLineSubtotal(line.quantity, line.unitSellPrice)),
    0,
  );

  const grossProfit = lines.reduce(
    (sum, line) => addMoney(sum, calculateLineGrossProfit(line.quantity, line.unitBuyPrice, line.unitSellPrice)),
    0,
  );

  const safeDiscountAmount = roundMoney(discountAmount);
  const safeTaxAmount = roundMoney(taxAmount);
  const totalAmount = addMoney(subtractMoney(subtotal, safeDiscountAmount), safeTaxAmount);

  // Tax is not treated as profit. Discount reduces profit because it reduces revenue.
  const totalProfit = subtractMoney(grossProfit, safeDiscountAmount);

  return {
    subtotal,
    totalProfit,
    totalAmount,
  };
}

export function calculateChange(paidAmount: number, totalAmount: number) {
  return subtractMoney(paidAmount, totalAmount);
}

/**
 * Bill totals computed from per-line profits that were already derived from the
 * *actual* FIFO lot costs consumed by each line — not from a buy-price guess.
 * Same accounting rules as calculateBillTotals:
 *   - subtotal   = Σ(quantity × unitSellPrice)
 *   - totalAmount = subtotal − discount + tax
 *   - totalProfit = Σ(lineProfit) − discount   (tax is not profit; discount is)
 *
 * Used by createFinalizedBill once FIFO allocation has produced exact line
 * profits, so Bill.totalProfit reflects real cost of goods sold.
 */
export function calculateBillTotalsFromActualCost(
  lines: Array<{ quantity: number; unitSellPrice: number; lineProfit: number }>,
  discountAmount: number,
  taxAmount: number,
) {
  const subtotal = lines.reduce(
    (sum, line) => addMoney(sum, calculateLineSubtotal(line.quantity, line.unitSellPrice)),
    0,
  );
  const grossProfit = lines.reduce((sum, line) => addMoney(sum, line.lineProfit), 0);

  const safeDiscountAmount = roundMoney(discountAmount);
  const safeTaxAmount = roundMoney(taxAmount);
  const totalAmount = addMoney(subtractMoney(subtotal, safeDiscountAmount), safeTaxAmount);
  const totalProfit = subtractMoney(grossProfit, safeDiscountAmount);

  return { subtotal, totalProfit, totalAmount };
}

/**
 * Allocate a bill's discount and tax proportionally to one line's amount/profit.
 * lineAmount must already reflect the net quantity (sold minus returned).
 * This is the single source of truth for per-item discount+tax allocation —
 * used by product reports, return calculations, and ledger summaries.
 */
export function calculateBillItemNetContribution(
  bill: { subtotal: number; discountAmount: number; taxAmount: number },
  lineAmount: number,
  lineProfit: number,
): { revenue: number; profit: number } {
  const subtotalRatio = bill.subtotal > 0 ? lineAmount / bill.subtotal : 0;
  const discountShare = allocateMoney(bill.discountAmount, subtotalRatio);
  const taxShare = allocateMoney(bill.taxAmount, subtotalRatio);
  return {
    revenue: addMoney(subtractMoney(lineAmount, discountShare), taxShare),
    profit: subtractMoney(lineProfit, discountShare),
  };
}
