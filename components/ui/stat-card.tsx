import Link from 'next/link';
import { Card } from './card';
import { FitText } from './fit-text';
import { ChevronRight } from './icons';
import clsx from 'clsx';

export function StatCard({
  label,
  value,
  helper,
  tone,
  href,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
  /** When set, the whole card becomes a link to its source records. */
  href?: string;
}) {
  const toneClass =
    tone === 'positive' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'danger' ? 'text-danger' :
    'text-fg';

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">{label}</p>
        {href && (
          <ChevronRight size={14} aria-hidden className="shrink-0 text-fg-muted" />
        )}
      </div>
      {/* FitText handles long currency strings ($115,540.30 etc.) by
          stepping down through a size ladder rather than clipping. */}
      <FitText
        value={String(value)}
        size="2xl"
        className={clsx('font-bold', toneClass)}
      />
      {helper && <p className="text-xs text-fg-muted mt-0.5">{helper}</p>}
    </>
  );

  if (href) {
    return (
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        href={href as any}
        className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Card className="flex flex-col gap-1 p-4 h-full transition-colors hover:bg-surface-soft hover:border-border-strong">
          {inner}
        </Card>
      </Link>
    );
  }

  return <Card className="flex flex-col gap-1 p-4">{inner}</Card>;
}
