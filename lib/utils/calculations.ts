import { roundMoney } from './money';

export function calculateLineSubtotal(quantity: number, unitSellPrice: number) {
  return roundMoney(quantity * unitSellPrice);
}

export function calculateLineProfit(quantity: number, unitBuyPrice: number, unitSellPrice: number) {
  return roundMoney(quantity * (unitSellPrice - unitBuyPrice));
}

export function calculateBillTotals(lines: Array<{ quantity: number; unitBuyPrice: number; unitSellPrice: number }>, discountAmount: number, taxAmount: number) {
  const subtotal = roundMoney(
    lines.reduce((sum, line) => sum + calculateLineSubtotal(line.quantity, line.unitSellPrice), 0),
  );

  const totalProfit = roundMoney(
    lines.reduce((sum, line) => sum + calculateLineProfit(line.quantity, line.unitBuyPrice, line.unitSellPrice), 0),
  );

  const totalAmount = roundMoney(subtotal - discountAmount + taxAmount);

  return {
    subtotal,
    totalProfit,
    totalAmount,
  };
}

export function calculateChange(paidAmount: number, totalAmount: number) {
  return roundMoney(paidAmount - totalAmount);
}
