import { Card } from './card';
import { FitText } from './fit-text';
import clsx from 'clsx';

export function StatCard({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'positive' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'danger' ? 'text-danger' :
    'text-fg';
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">{label}</p>
      {/* FitText handles long currency strings ($115,540.30 etc.) by
          stepping down through a size ladder rather than clipping. */}
      <FitText
        value={String(value)}
        size="2xl"
        className={clsx('font-bold', toneClass)}
      />
      {helper && <p className="text-xs text-fg-muted mt-0.5">{helper}</p>}
    </Card>
  );
}
