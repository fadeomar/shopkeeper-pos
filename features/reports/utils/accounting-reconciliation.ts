import type {
  Bill,
  CashMovement,
  CustomerPayment,
  Expense,
  Purchase,
  Shift,
  SupplierPayment,
} from '@/types/domain';
import { netSplitField, normalizeBillSplit } from '@/lib/utils/bill-split';
import { MONEY_EPSILON, roundMoney } from '@/lib/utils/money';

export interface CashDrawerReconciliationInput {
  bills: Bill[];
  purchases: Purchase[];
  customerPayments: CustomerPayment[];
  supplierPayments: SupplierPayment[];
  expenses: Expense[];
  cashMovements: CashMovement[];
  shifts?: Shift[];
}

export type AccountingIssueSeverity = 'info' | 'warning' | 'danger';
export type AccountingIssueKey = 'drawer_records_without_shift' | 'split_mismatch';

export interface AccountingIssue {
  key: AccountingIssueKey;
  severity: AccountingIssueSeverity;
  count: number;
  sampleLabels: string[];
}

export interface CashDrawerReconciliation {
  openingCash: number;
  salesCash: number;
  customerCashIn: number;
  purchaseCashOut: number;
  supplierCashOut: number;
  expenseCashOut: number;
  manualCashIn: number;
  manualCashOut: number;
  manualCashNet: number;
  moneyIn: number;
  moneyOut: number;
  expectedDrawer: number;
  issues: AccountingIssue[];
  issueCount: number;
  rowsWithoutShiftCount: number;
  splitMismatchCount: number;
}

function isCashCustomerPayment(payment: CustomerPayment): boolean {
  return !payment.paymentMethod || payment.paymentMethod === 'cash';
}

function isCashSupplierPayment(payment: SupplierPayment): boolean {
  return !payment.paymentMethod || payment.paymentMethod === 'cash';
}

function hasMeaningfulAmount(value: number): boolean {
  return Math.abs(value) > MONEY_EPSILON;
}

function splitMismatchLabel(row: Bill | Purchase): string {
  if ('billNumber' in row) return row.billNumber;
  return row.purchaseNumber;
}

function findSplitMismatchRows(rows: Array<Bill | Purchase>): string[] {
  const labels: string[] = [];
  for (const raw of rows) {
    const row = normalizeBillSplit(raw);
    const splitTotal = roundMoney(
      (Number(row.cashAmount) || 0) +
        (Number(row.cardAmount) || 0) +
        (Number(row.creditAmount) || 0),
    );
    const total = roundMoney(Number(row.totalAmount) || 0);
    if (Math.abs(splitTotal - total) > MONEY_EPSILON) {
      labels.push(splitMismatchLabel(raw));
    }
  }
  return labels;
}

function buildMissingShiftLabels(input: CashDrawerReconciliationInput): string[] {
  const labels: string[] = [];

  for (const raw of input.bills) {
    const bill = normalizeBillSplit(raw);
    const cash = netSplitField(bill, bill.cashAmount);
    if (!raw.shiftId && hasMeaningfulAmount(cash)) labels.push(raw.billNumber);
  }

  for (const raw of input.purchases) {
    const purchase = normalizeBillSplit(raw);
    const cash = netSplitField(purchase, purchase.cashAmount);
    if (!raw.shiftId && hasMeaningfulAmount(cash)) labels.push(raw.purchaseNumber);
  }

  for (const payment of input.customerPayments) {
    if (!payment.shiftId && isCashCustomerPayment(payment) && hasMeaningfulAmount(payment.amount)) {
      labels.push(payment.customerName || payment.customerKey);
    }
  }

  for (const payment of input.supplierPayments) {
    if (!payment.shiftId && isCashSupplierPayment(payment) && hasMeaningfulAmount(payment.amount)) {
      labels.push(payment.supplierName || payment.supplierKey);
    }
  }

  for (const expense of input.expenses) {
    if (!expense.shiftId && expense.paymentMethod === 'cash' && hasMeaningfulAmount(expense.amount)) {
      labels.push(expense.payee || expense.category);
    }
  }

  for (const movement of input.cashMovements) {
    if (!movement.shiftId && hasMeaningfulAmount(movement.amount)) {
      labels.push(movement.referenceLabel || movement.reason || movement.type);
    }
  }

  return labels;
}

/**
 * Single source of truth for date/range drawer reconciliation used by Reports
 * and the printable Z report.
 *
 * Formula:
 *   opening cash
 * + cash from sales
 * + customer cash payments
 * - cash purchases
 * - supplier cash payments
 * - cash expenses
 * +/- manual cash movements
 * = expected drawer
 */
export function buildCashDrawerReconciliation(
  input: CashDrawerReconciliationInput,
): CashDrawerReconciliation {
  const openingCash = roundMoney(
    (input.shifts ?? []).reduce((sum, shift) => sum + (Number(shift.openingCash) || 0), 0),
  );

  const salesCash = roundMoney(
    input.bills.reduce((sum, raw) => {
      const bill = normalizeBillSplit(raw);
      return sum + netSplitField(bill, bill.cashAmount);
    }, 0),
  );

  const customerCashIn = roundMoney(
    input.customerPayments
      .filter(isCashCustomerPayment)
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0),
  );

  const purchaseCashOut = roundMoney(
    input.purchases.reduce((sum, raw) => {
      const purchase = normalizeBillSplit(raw);
      return sum + netSplitField(purchase, purchase.cashAmount);
    }, 0),
  );

  const supplierCashOut = roundMoney(
    input.supplierPayments
      .filter(isCashSupplierPayment)
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0),
  );

  const expenseCashOut = roundMoney(
    input.expenses
      .filter((expense) => expense.paymentMethod === 'cash')
      .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0),
  );

  let manualCashIn = 0;
  let manualCashOut = 0;
  for (const movement of input.cashMovements) {
    const amount = Number(movement.amount) || 0;
    if (amount >= 0) manualCashIn += amount;
    else manualCashOut += Math.abs(amount);
  }
  manualCashIn = roundMoney(manualCashIn);
  manualCashOut = roundMoney(manualCashOut);
  const manualCashNet = roundMoney(manualCashIn - manualCashOut);

  const moneyIn = roundMoney(salesCash + customerCashIn + manualCashIn);
  const moneyOut = roundMoney(purchaseCashOut + supplierCashOut + expenseCashOut + manualCashOut);
  const expectedDrawer = roundMoney(openingCash + moneyIn - moneyOut);

  const issues: AccountingIssue[] = [];
  const missingShiftLabels = buildMissingShiftLabels(input);
  if (missingShiftLabels.length > 0) {
    issues.push({
      key: 'drawer_records_without_shift',
      severity: 'warning',
      count: missingShiftLabels.length,
      sampleLabels: missingShiftLabels.slice(0, 5),
    });
  }

  const splitMismatchLabels = findSplitMismatchRows([...input.bills, ...input.purchases]);
  if (splitMismatchLabels.length > 0) {
    issues.push({
      key: 'split_mismatch',
      severity: 'danger',
      count: splitMismatchLabels.length,
      sampleLabels: splitMismatchLabels.slice(0, 5),
    });
  }

  return {
    openingCash,
    salesCash,
    customerCashIn,
    purchaseCashOut,
    supplierCashOut,
    expenseCashOut,
    manualCashIn,
    manualCashOut,
    manualCashNet,
    moneyIn,
    moneyOut,
    expectedDrawer,
    issues,
    issueCount: issues.reduce((sum, issue) => sum + issue.count, 0),
    rowsWithoutShiftCount: missingShiftLabels.length,
    splitMismatchCount: splitMismatchLabels.length,
  };
}
