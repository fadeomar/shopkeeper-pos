import Link from 'next/link';
import { FitText } from './fit-text';
import { ChevronRight } from './icons';
import clsx from 'clsx';

type Tone = 'neutral' | 'positive' | 'warning' | 'danger' | 'brand' | 'info';

// Value text colour per tone. Applied in every mode (this preserves the
// existing behaviour where `tone` only tinted the number).
const VALUE_TONE: Record<Tone, string> = {
  neutral: 'text-fg',
  positive: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  brand: 'text-brand',
  info: 'text-info',
};

// Soft tinted surface + matching border, used only when `filled` is set.
// Keeps the colour flow consistent with the app's semantic tokens.
const FILL_SURFACE: Record<Tone, string> = {
  neutral: 'bg-surface-soft border-border-default',
  positive: 'bg-success-soft border-success/25',
  warning: 'bg-warning-soft border-warning/25',
  danger: 'bg-danger-soft border-danger/25',
  brand: 'bg-brand-soft border-brand/25',
  info: 'bg-info-soft border-info/25',
};

const FILL_HOVER: Record<Tone, string> = {
  neutral: 'hover:border-border-strong',
  positive: 'hover:border-success/50',
  warning: 'hover:border-warning/50',
  danger: 'hover:border-danger/50',
  brand: 'hover:border-brand/50',
  info: 'hover:border-info/50',
};

export function StatCard({
  label,
  value,
  helper,
  tone = 'neutral',
  filled = false,
  href,
  className,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: Tone;
  /**
   * When true, the card paints a soft tinted background + matching border
   * derived from `tone` (used by the reports dashboard for a colour-coded
   * card flow). When false (default) the card stays plain white so existing
   * usages elsewhere are visually unchanged.
   */
  filled?: boolean;
  /** When set, the whole card becomes a link to its source records. */
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">{label}</p>
        {href && (
          <ChevronRight size={14} aria-hidden className="shrink-0 text-fg-muted" />
        )}
      </div>
      {/* FitText handles long currency strings (₪115,540.30 etc.) by
          stepping down through a size ladder rather than clipping. */}
      <FitText
        value={String(value)}
        size="2xl"
        className={clsx('font-bold', VALUE_TONE[tone])}
      />
      {helper && <p className="text-xs text-fg-muted mt-0.5">{helper}</p>}
    </>
  );

  // Base container mirrors the shared Card look (rounded-2xl, subtle shadow,
  // 1px border) so filled and non-filled cards sit together cleanly.
  const base = 'flex flex-col gap-1 rounded-2xl border p-4 shadow-xs';
  const surface = filled ? FILL_SURFACE[tone] : 'bg-surface border-border-default';

  if (href) {
    const hover = filled
      ? FILL_HOVER[tone]
      : 'hover:bg-surface-soft hover:border-border-strong';
    return (
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        href={href as any}
        className={clsx(
          'block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          className,
        )}
      >
        <div className={clsx(base, 'h-full transition-colors', surface, hover)}>
          {inner}
        </div>
      </Link>
    );
  }

  return <div className={clsx(base, surface, className)}>{inner}</div>;
}
