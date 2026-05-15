import type { Bill, BillItem, Settings } from "@/types/domain";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { getBillNetTotal } from "@/features/bills/utils/bill-summary";
import { normalizeBillSplit } from "@/lib/utils/bill-split";

export function buildReceiptText({
  bill,
  items,
  settings,
  labels,
}: {
  bill: Bill;
  items: BillItem[];
  settings?: Settings;
  labels: {
    receipt: string;
    billNumber: string;
    dateTime: string;
    cashier: string;
    customer: string;
    payment: string;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    returnedAmount: string;
    netTotal: string;
    status: string;
    billStatus: string;
    paid: string;
    change: string;
    cashLabel: string;
    cardLabel: string;
    creditLabel: string;
    qty: string;
    thankYou: string;
    walkin: string;
    paymentMethod: string;
  };
}) {
  const currency = settings?.currency ?? "USD";
  const storeName = settings?.storeName || "Shopkeeper POS";
  const withSplit = normalizeBillSplit(bill) as Bill;
  // Show the split breakdown only when the bill exercises more than one
  // method — pure cash / pure card / pure credit bills don't need an extra
  // section.
  const splitLines: string[] = [];
  const usedMethods = [
    withSplit.cashAmount > 0 ? `${labels.cashLabel}: ${formatCurrency(withSplit.cashAmount, currency)}` : null,
    withSplit.cardAmount > 0 ? `${labels.cardLabel}: ${formatCurrency(withSplit.cardAmount, currency)}` : null,
    withSplit.creditAmount > 0 ? `${labels.creditLabel}: ${formatCurrency(withSplit.creditAmount, currency)}` : null,
  ].filter((line): line is string => line !== null);
  if (usedMethods.length > 1) splitLines.push(...usedMethods);

  const lines = [
    storeName,
    labels.receipt,
    "------------------------------",
    `${labels.billNumber}: ${bill.billNumber}`,
    `${labels.dateTime}: ${formatDateTime(bill.createdAt)}`,
    `${labels.cashier}: ${bill.cashierName || settings?.cashierName || "-"}`,
    `${labels.customer}: ${bill.customerName || labels.walkin}`,
    `${labels.payment}: ${labels.paymentMethod}`,
    `${labels.status}: ${labels.billStatus}`,
    "------------------------------",
    ...items.map((item) =>
      [
        item.productNameAtSale,
        `${labels.qty}: ${item.quantitySold} x ${formatCurrency(item.unitSellPriceAtSale, currency)} = ${formatCurrency(item.lineSubtotal, currency)}`,
      ].join("\n"),
    ),
    "------------------------------",
    `${labels.subtotal}: ${formatCurrency(bill.subtotal, currency)}`,
    `${labels.discount}: ${formatCurrency(bill.discountAmount, currency)}`,
    `${labels.tax}: ${formatCurrency(bill.taxAmount, currency)}`,
    `${labels.total}: ${formatCurrency(bill.totalAmount, currency)}`,
    ...((bill.returnedAmount ?? 0) > 0
      ? [
          `${labels.returnedAmount}: -${formatCurrency(bill.returnedAmount ?? 0, currency)}`,
          `${labels.netTotal}: ${formatCurrency(getBillNetTotal(bill), currency)}`,
        ]
      : []),
    ...splitLines,
    `${labels.paid}: ${formatCurrency(bill.paidAmount, currency)}`,
    `${labels.change}: ${formatCurrency(bill.changeAmount, currency)}`,
    "------------------------------",
    labels.thankYou,
  ];

  return lines.join("\n");
}
