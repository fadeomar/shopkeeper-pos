import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import clsx from 'clsx';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: PropsWithChildren<Props>) {
  return (
    <button
      className={clsx(
        /* base */
        'inline-flex items-center justify-center gap-2 font-semibold rounded-xl',
        'transition-colors duration-150 cursor-pointer',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        /* size */
        size === 'md' && 'px-4 py-2.5 text-sm min-h-[42px]',
        size === 'sm' && 'px-3 py-1.5 text-xs min-h-[32px]',
        /* variant */
        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
        variant === 'secondary' && 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300',
        variant === 'danger' && 'bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200',
        variant === 'ghost' && 'bg-transparent border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
