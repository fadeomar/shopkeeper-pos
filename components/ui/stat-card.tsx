import { Card } from './card';
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
    tone === 'positive' ? 'text-emerald-700' :
    tone === 'warning' ? 'text-amber-700' :
    tone === 'danger' ? 'text-red-700' :
    'text-slate-900';
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={clsx('text-2xl font-bold tabular-nums', toneClass)}>{value}</p>
      {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
    </Card>
  );
}
