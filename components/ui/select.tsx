import type { SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white',
        'text-slate-900',
        'transition-colors duration-150',
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50',
        'cursor-pointer',
        className,
      )}
      {...props}
    />
  );
}
