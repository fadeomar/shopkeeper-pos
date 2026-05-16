export const colors = {
  background: {
    app: "#f8fafc",
    surface: "#ffffff",
    surfaceSoft: "#f1f5f9",
    surfaceMuted: "#e2e8f0",
  },
  text: {
    primary: "#0f172a",
    secondary: "#334155",
    muted: "#64748b",
    inverse: "#ffffff",
  },
  border: {
    subtle: "#f1f5f9",
    default: "#e2e8f0",
    strong: "#cbd5e1",
  },
  brand: {
    primary: "#2563eb",
    primaryHover: "#1d4ed8",
    primarySoft: "#dbeafe",
  },
  states: {
    success: "#15803d",
    successSoft: "#dcfce7",
    warning: "#b45309",
    warningSoft: "#fef3c7",
    danger: "#dc2626",
    dangerSoft: "#fee2e2",
    info: "#2563eb",
    infoSoft: "#dbeafe",
    neutral: "#475569",
    neutralSoft: "#f1f5f9",
  },
} as const;

export const spacing = {
  0: "0",
  px: "1px",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
} as const;

export const typography = {
  fontFamily: {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Arabic', 'Arabic UI Text', sans-serif",
    mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  },
  fontSizes: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
  },
  fontWeights: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    black: "900",
  },
  lineHeights: {
    tight: "1.2",
    normal: "1.5",
    relaxed: "1.7",
  },
} as const;

export const radius = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  "2xl": "1.25rem",
  "3xl": "1.5rem",
  full: "9999px",
} as const;

export const shadows = {
  none: "none",
  xs: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
  sm: "0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.08)",
  md: "0 8px 24px -12px rgb(15 23 42 / 0.25)",
  lg: "0 20px 35px -20px rgb(15 23 42 / 0.35)",
} as const;

export const borders = {
  widths: {
    none: "0",
    hairline: "1px",
    strong: "2px",
  },
} as const;

export const layout = {
  pageMaxWidth: "72rem",
  pageWideMaxWidth: "96rem",
  sidebarWidth: "260px",
  tableMinWidth: "1040px",
  stickyActionOffset: "0px",
} as const;

export const zIndex = {
  dropdown: 20,
  sticky: 30,
  modal: 50,
  toast: 100,
} as const;

export const touchTargets = {
  compact: "2rem",
  default: "2.75rem",
  large: "3rem",
  pos: "3.5rem",
} as const;

export const componentDensity = {
  compact: "compact",
  comfortable: "comfortable",
  spacious: "spacious",
} as const;
