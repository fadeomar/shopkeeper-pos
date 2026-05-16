import type { StatusTone } from "./status";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export const buttonVariants = {
  primary:
    "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 border border-blue-600 shadow-xs",
  secondary:
    "bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 border border-slate-200",
  danger:
    "bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200 border border-red-100",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-50 active:bg-slate-100 border border-transparent",
  outline:
    "bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 border border-slate-300",
  success:
    "bg-green-600 text-white hover:bg-green-700 active:bg-green-800 border border-green-600 shadow-xs",
  warning:
    "bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700 border border-amber-500 shadow-xs",
  soft: "bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200 border border-blue-100",
  link: "bg-transparent text-blue-700 hover:text-blue-800 underline-offset-4 hover:underline border border-transparent px-0 shadow-none",
} as const;

export const buttonSizes = {
  xs: "h-8 px-2.5 text-xs rounded-lg",
  sm: "h-9 px-3 text-xs rounded-xl",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-12 px-5 text-sm rounded-2xl",
  xl: "h-14 px-6 text-base rounded-2xl",
  icon: "h-11 w-11 p-0 rounded-xl",
} as const;

export const inputVariants = {
  default:
    "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500",
  error:
    "border-red-400 bg-white text-slate-900 placeholder:text-red-300 focus:border-red-500 focus:ring-red-500",
} as const;

export const inputSizes = {
  xs: "h-8 px-2.5 text-xs rounded-lg",
  sm: "h-9 px-3 text-sm rounded-xl",
  md: "h-11 px-3.5 text-sm rounded-xl",
  lg: "h-12 px-4 text-base rounded-2xl",
} as const;

export const cardVariants = {
  default: "bg-white border border-slate-200 shadow-xs",
  elevated: "bg-white border border-slate-200 shadow-md",
  soft: "bg-slate-50 border border-slate-200 shadow-none",
  interactive:
    "bg-white border border-slate-200 shadow-xs hover:border-blue-200 hover:shadow-sm transition",
  success: "bg-green-50 border border-green-100 shadow-none",
  warning: "bg-amber-50 border border-amber-100 shadow-none",
  danger: "bg-red-50 border border-red-100 shadow-none",
} as const;

export const cardPadding = {
  none: "p-0",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
  xl: "p-7",
} as const;

export const badgeTones = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  info: "bg-blue-50 text-blue-700 border-blue-100",
  success: "bg-green-50 text-green-700 border-green-100",
  warning: "bg-amber-50 text-amber-700 border-amber-100",
  danger: "bg-red-50 text-red-700 border-red-100",
} as const satisfies Record<StatusTone, string>;

export const badgeSizes = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
} as const;

export const iconContainerTones = {
  neutral: "bg-slate-100 text-slate-500",
  info: "bg-blue-50 text-blue-600",
  success: "bg-green-50 text-green-600",
  warning: "bg-amber-50 text-amber-600",
  danger: "bg-red-50 text-red-600",
} as const satisfies Record<StatusTone, string>;

export const alertTones = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  info: "border-blue-100 bg-blue-50 text-blue-700",
  success: "border-green-100 bg-green-50 text-green-700",
  warning: "border-amber-100 bg-amber-50 text-amber-800",
  danger: "border-red-100 bg-red-50 text-red-700",
} as const satisfies Record<StatusTone, string>;

export const panelTones = {
  neutral: "border-slate-100 bg-slate-50 text-slate-600",
  info: "border-blue-100 bg-blue-50 text-blue-700",
  success: "border-green-100 bg-green-50 text-green-700",
  warning: "border-amber-100 bg-amber-50 text-amber-800",
  danger: "border-red-100 bg-red-50 text-red-700",
} as const satisfies Record<StatusTone, string>;

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

export const mobileCardClasses = {
  item: "rounded-2xl border border-slate-100 bg-white p-3 shadow-xs",
  row: "flex items-center justify-between gap-3 py-3",
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

export const pageShellVariants = {
  default: "mx-auto w-full max-w-6xl",
  wide: "mx-auto w-full max-w-7xl",
  full: "w-full",
} as const;

export const sectionSpacing = {
  sm: "gap-3",
  md: "gap-5",
  lg: "gap-6",
} as const;

export const tableShellVariants = {
  default: "overflow-hidden",
  plain: "overflow-hidden shadow-none",
} as const;

export const formFieldSpacing = {
  default: "flex flex-col gap-1.5",
  compact: "flex flex-col gap-1",
} as const;

export const typographyClasses = {
  pageTitle: "text-xl sm:text-2xl font-bold tracking-tight text-slate-900",
  pageDescription: "text-sm text-slate-500 leading-6",
  sectionTitle: "text-base font-semibold text-slate-900",
  sectionDescription: "text-sm text-slate-500 leading-6",
  label: "text-sm font-medium text-slate-700",
  hint: "text-xs text-slate-500 leading-5",
  error: "text-xs font-medium text-red-600 leading-5",
  tableHeader:
    "px-3 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide",
  tableCell: "px-3 py-2.5 text-sm text-slate-600",
  tableCellMuted: "px-3 py-3 text-slate-500",
  tableCellStrong: "px-3 py-3 font-medium text-slate-800",
  statLabel: "text-xs font-medium uppercase tracking-wide text-slate-500",
  statValue: "text-2xl font-bold text-slate-900",
  statHelper: "text-xs text-slate-400",
  emptyTitle: "text-base font-semibold text-slate-700",
  bodyMuted: "text-sm leading-6 text-slate-500",
  body: "text-sm text-slate-600",
} as const;
