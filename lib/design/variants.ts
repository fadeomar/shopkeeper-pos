export const badgeTones = {
  neutral: "border-border-default bg-surface-muted text-fg-secondary",
  info: "border-info/20 bg-info-soft text-info",
  success: "border-success/20 bg-success-soft text-success",
  warning: "border-warning/20 bg-warning-soft text-warning",
  danger: "border-danger/20 bg-danger-soft text-danger",
} as const;

export const alertTones = {
  neutral: "border-border-default bg-surface-soft text-fg-secondary",
  info: "border-info/20 bg-info-soft text-info",
  success: "border-success/20 bg-success-soft text-success",
  warning: "border-warning/20 bg-warning-soft text-warning",
  danger: "border-danger/20 bg-danger-soft text-danger",
} as const;

export const panelTones = {
  neutral: "border-border-default bg-surface-soft",
  info: "border-info/20 bg-info-soft/70",
  success: "border-success/20 bg-success-soft/70",
  warning: "border-warning/20 bg-warning-soft/80",
  danger: "border-danger/20 bg-danger-soft/80",
} as const;

export const typographyClasses = {
  label: "text-sm font-medium text-fg-secondary",
  hint: "text-xs text-fg-muted",
  error: "text-xs font-medium text-danger",
  muted: "text-sm text-fg-muted",
  tableHead:
    "px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-fg-muted",
  tableCell: "px-3 py-2.5 text-sm text-fg-secondary",
} as const;

export const mobileCardClasses =
  "touch-card rounded-2xl border border-border-default bg-surface p-3 shadow-xs active:bg-surface-soft";

export const dividerClasses = {
  subtle: "divide-y divide-border-subtle",
  borderSubtle: "border-border-subtle",
  borderDefault: "border-border-default",
} as const;

export const surfaceClasses = {
  app: "bg-app text-fg",
  surface: "bg-surface text-fg",
  surfaceSoft: "bg-surface-soft text-fg-secondary",
  muted: "bg-surface-muted text-fg-muted",
  // Neutral dark scrim for modal backdrops — intentionally a raw slate value,
  // not a status/brand token.
  modalBackdrop: "bg-slate-900/50 backdrop-blur-xs",
} as const;

export const actionRowClasses = {
  default: "flex flex-wrap items-center gap-2",
  end: "flex flex-wrap items-center justify-end gap-2",
  between: "flex flex-wrap items-center justify-between gap-3",
  stickyCheckout:
    "flex flex-col gap-2 border-t border-border-default bg-surface/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-end",
} as const;

export const priceDisplaySizes = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-xl",
} as const;

export const loadingSpinnerClasses = {
  sm: "size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
  md: "size-5 animate-spin rounded-full border-2 border-border-strong border-t-brand",
} as const;
