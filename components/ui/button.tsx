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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
        fullWidth && 'w-full',
        size === 'xs' && 'px-2.5 py-1 text-xs min-h-[28px]',
        size === 'sm' && 'px-3 py-1.5 text-xs min-h-[32px]',
        size === 'md' && 'px-4 py-2.5 text-sm min-h-[42px]',
        size === 'lg' && 'px-5 py-3 text-sm min-h-[48px]',
        size === 'xl' && 'px-6 py-3.5 text-base min-h-[54px]',
        size === 'icon' && 'h-10 w-10 p-0 text-sm',
        variant === 'primary' && 'bg-brand text-fg-inverse hover:bg-brand-hover active:bg-brand-hover',
        variant === 'secondary' && 'bg-surface-soft text-fg-secondary hover:bg-surface-muted active:bg-surface-muted',
        variant === 'outline' && 'border border-border-default bg-surface text-fg-secondary hover:bg-surface-soft hover:border-border-strong',
        variant === 'danger' && 'bg-danger-soft text-danger hover:bg-danger-soft/80 active:bg-danger-soft/60',
        variant === 'success' && 'bg-success text-fg-inverse hover:bg-success/90 active:bg-success/80',
        variant === 'warning' && 'bg-warning-soft text-warning hover:bg-warning-soft/80 active:bg-warning-soft/60',
        variant === 'soft' && 'bg-brand-soft text-brand hover:bg-brand-soft/80 active:bg-brand-soft/60',
        variant === 'ghost' && 'bg-transparent border border-border-default text-fg-muted hover:bg-surface-soft hover:border-border-strong',
        variant === 'link' && 'min-h-0 rounded-md bg-transparent p-0 text-info underline-offset-4 hover:underline',
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
