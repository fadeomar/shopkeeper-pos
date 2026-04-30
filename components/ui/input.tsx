import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, error, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        'w-full px-3 py-2.5 text-sm rounded-xl border bg-white',
        'text-slate-900 placeholder:text-slate-400',
        'transition-colors duration-150',
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50',
        'read-only:bg-slate-50 read-only:cursor-default',
        error
          ? 'border-red-400 focus:ring-red-400 focus:border-red-400'
          : 'border-slate-200',
        className,
      )}
      {...props}
    />
  );
});
