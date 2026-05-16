export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusMeta {
  tone: StatusTone;
  labelKey?: string;
  label?: string;
  iconName?: string;
  className?: string;
}

export const syncStatuses = {
  online: { tone: "success", labelKey: "sync.online", iconName: "wifi" },
  offline: { tone: "warning", labelKey: "sync.offline", iconName: "wifi-off" },
  synced: { tone: "success", labelKey: "sync.synced", iconName: "check" },
  pendingSync: {
    tone: "warning",
    labelKey: "sync.pendingSync",
    label: "Pending sync",
    iconName: "clock",
  },
  pending: { tone: "warning", labelKey: "sync.pending", iconName: "clock" },
  syncing: { tone: "info", labelKey: "sync.syncing", iconName: "refresh" },
  conflict: { tone: "warning", labelKey: "sync.conflict", iconName: "alert" },
  error: {
    tone: "danger",
    labelKey: "sync.error",
    label: "Error",
    iconName: "x",
  },
  failed: { tone: "danger", labelKey: "sync.failed", iconName: "x" },
  blocked: { tone: "danger", labelKey: "sync.blocked", iconName: "ban" },
} as const satisfies Record<string, StatusMeta>;

export const paymentStatuses = {
  paid: { tone: "success", labelKey: "payment.paid", label: "Paid" },
  unpaid: { tone: "danger", labelKey: "payment.unpaid", label: "Unpaid" },
  partial: { tone: "warning", labelKey: "payment.partial", label: "Partial" },
  refunded: {
    tone: "neutral",
    labelKey: "payment.refunded",
    label: "Refunded",
  },
  draft: { tone: "neutral", labelKey: "payment.draft", label: "Draft" },
  cancelled: {
    tone: "danger",
    labelKey: "payment.cancelled",
    label: "Cancelled",
  },
} as const satisfies Record<string, StatusMeta>;

export const stockStatuses = {
  inStock: { tone: "success", labelKey: "stock.inStock", label: "In stock" },
  lowStock: { tone: "warning", labelKey: "stock.lowStock", label: "Low stock" },
  outOfStock: {
    tone: "danger",
    labelKey: "stock.outOfStock",
    label: "Out of stock",
  },
} as const satisfies Record<string, StatusMeta>;

export const shiftStatuses = {
  shiftOpen: { tone: "success", labelKey: "shift.open", label: "Shift open" },
  shiftClosed: {
    tone: "neutral",
    labelKey: "shift.closed",
    label: "Shift closed",
  },
} as const satisfies Record<string, StatusMeta>;

export const billStatuses = {
  completed: {
    tone: "success",
    labelKey: "bills.completed",
    label: "Completed",
  },
  pending: { tone: "warning", labelKey: "bills.pending", label: "Pending" },
  voided: { tone: "danger", labelKey: "bills.voided", label: "Voided" },
  returned: { tone: "warning", labelKey: "bills.returned", label: "Returned" },
} as const satisfies Record<string, StatusMeta>;

export const allStatuses = {
  ...syncStatuses,
  ...paymentStatuses,
  ...stockStatuses,
  ...shiftStatuses,
  ...billStatuses,
} as const;

export type KnownStatusKey = keyof typeof allStatuses;

export function getStatusMeta(status: string): StatusMeta | undefined {
  return allStatuses[status as KnownStatusKey];
}
