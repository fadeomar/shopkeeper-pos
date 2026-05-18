export const badgeTones = {
  neutral: "border-slate-200 bg-slate-100 text-slate-700",
  info: "border-blue-100 bg-blue-50 text-blue-700",
  success: "border-emerald-100 bg-emerald-50 text-emerald-700",
  warning: "border-amber-100 bg-amber-50 text-amber-700",
  danger: "border-red-100 bg-red-50 text-red-700",
} as const;

export const alertTones = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  info: "border-blue-100 bg-blue-50 text-blue-700",
  success: "border-emerald-100 bg-emerald-50 text-emerald-700",
  warning: "border-amber-100 bg-amber-50 text-amber-800",
  danger: "border-red-100 bg-red-50 text-red-700",
} as const;

export const panelTones = {
  neutral: "border-slate-200 bg-slate-50",
  info: "border-blue-100 bg-blue-50/70",
  success: "border-emerald-100 bg-emerald-50/70",
  warning: "border-amber-100 bg-amber-50/80",
  danger: "border-red-100 bg-red-50/80",
} as const;

export const typographyClasses = {
  label: "text-sm font-medium text-slate-700",
  hint: "text-xs text-slate-500",
  error: "text-xs font-medium text-red-600",
  muted: "text-sm text-slate-500",
  tableHead:
    "px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-slate-500",
  tableCell: "px-3 py-2.5 text-sm text-slate-700",
} as const;

export const mobileCardClasses =
  "touch-card rounded-2xl border border-slate-200 bg-white p-3 shadow-xs active:bg-slate-50";

export const dividerClasses = {
  subtle: "divide-y divide-slate-100",
  borderSubtle: "border-slate-100",
  borderDefault: "border-slate-200",
} as const;

export const surfaceClasses = {
  app: "bg-slate-50 text-slate-900",
  surface: "bg-white text-slate-900",
  surfaceSoft: "bg-slate-50 text-slate-700",
  muted: "bg-slate-100 text-slate-600",
  modalBackdrop: "bg-slate-900/50 backdrop-blur-xs",
} as const;

export const actionRowClasses = {
  default: "flex flex-wrap items-center gap-2",
  end: "flex flex-wrap items-center justify-end gap-2",
  between: "flex flex-wrap items-center justify-between gap-3",
  stickyCheckout:
    "flex flex-col gap-2 border-t border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-end",
} as const;

export const priceDisplaySizes = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-xl",
} as const;

export const loadingSpinnerClasses = {
  sm: "size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
  md: "size-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600",
} as const;
