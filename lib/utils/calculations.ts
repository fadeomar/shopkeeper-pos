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
