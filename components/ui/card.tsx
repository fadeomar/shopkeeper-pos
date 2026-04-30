import type { PropsWithChildren, HTMLAttributes } from 'react';
import clsx from 'clsx';

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg';
}

export function Card({ children, className, padding = 'md', ...props }: PropsWithChildren<Props>) {
  return (
    <div
      className={clsx(
        'bg-white border border-slate-200 rounded-2xl shadow-xs',
        padding === 'sm' && 'p-4',
        padding === 'md' && 'p-5',
        padding === 'lg' && 'p-6',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
