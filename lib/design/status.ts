export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export const syncStatusTone: Record<string, Tone> = {
  online: "success",
  offline: "danger",
  synced: "success",
  pending: "warning",
  pendingSync: "warning",
  syncing: "info",
  failed: "danger",
  conflict: "warning",
  blocked: "danger",
  error: "danger",
};
export const paymentStatusTone: Record<string, Tone> = {
  cash: "success",
  card: "info",
  mixed: "warning",
  credit: "warning",
  paid: "success",
  unpaid: "warning",
  partial: "warning",
  refunded: "neutral",
  voided: "danger",
};
