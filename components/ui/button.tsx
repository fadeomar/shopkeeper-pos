import type { ButtonHTMLAttributes, PropsWithChildren, Ref } from 'react';
import clsx from 'clsx';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'success' | 'warning' | 'soft' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'icon';
  loading?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  ...props
}: PropsWithChildren<Props>) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
        'transition-colors duration-150 cursor-pointer',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        fullWidth && 'w-full',
        size === 'xs' && 'px-2.5 py-1 text-xs min-h-[28px]',
        size === 'sm' && 'px-3 py-1.5 text-xs min-h-[32px]',
        size === 'md' && 'px-4 py-2.5 text-sm min-h-[42px]',
        size === 'lg' && 'px-5 py-3 text-sm min-h-[48px]',
        size === 'xl' && 'px-6 py-3.5 text-base min-h-[54px]',
        size === 'icon' && 'h-10 w-10 p-0 text-sm',
        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
        variant === 'secondary' && 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300',
        variant === 'outline' && 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300',
        variant === 'danger' && 'bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200',
        variant === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
        variant === 'warning' && 'bg-amber-100 text-amber-800 hover:bg-amber-200 active:bg-amber-300',
        variant === 'soft' && 'bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200',
        variant === 'ghost' && 'bg-transparent border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300',
        variant === 'link' && 'min-h-0 rounded-md bg-transparent p-0 text-blue-600 underline-offset-4 hover:underline',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}
