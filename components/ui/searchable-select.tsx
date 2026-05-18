'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  meta?: ReactNode;
  disabled?: boolean;
};

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  clearable?: boolean;
  className?: string;
  buttonClassName?: string;
  name?: string;
  id?: string;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No options found',
  disabled,
  loading,
  clearable,
  className,
  buttonClassName,
  name,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => [option.label, option.description].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlightedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [open]);

  function selectOption(option: SearchableSelectOption | undefined) {
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <input type="hidden" name={name} value={value ?? ''} />
      <Button
        id={id}
        type="button"
        variant="outline"
        fullWidth
        disabled={disabled}
        className={clsx('justify-between text-start font-medium', !selected && 'text-slate-400', buttonClassName)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <span aria-hidden="true" className="text-slate-400">⌄</span>
      </Button>

      {open && (
        <div className="absolute z-50 mt-2 w-full min-w-[14rem] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <Input
            ref={inputRef}
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
              if (event.key === 'ArrowDown') { event.preventDefault(); setHighlightedIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setHighlightedIndex((index) => Math.max(index - 1, 0)); }
              if (event.key === 'Enter') { event.preventDefault(); selectOption(filtered[highlightedIndex] ?? filtered[0]); }
            }}
          />
          <div role="listbox" className="mt-2 max-h-72 overflow-y-auto rounded-xl">
            {loading ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">Loading…</div>
            ) : filtered.length === 0 ? (
              <EmptyState title={emptyMessage} compact />
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  className={clsx(
                    'flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-start text-sm transition-colors',
                    index === highlightedIndex && 'bg-slate-50',
                    option.value === value && 'bg-blue-50 text-blue-700',
                    option.disabled && 'cursor-not-allowed opacity-50',
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.description && <span className="mt-0.5 block truncate text-xs text-slate-500">{option.description}</span>}
                  </span>
                  {option.meta && <span className="shrink-0">{option.meta}</span>}
                </button>
              ))
            )}
          </div>
          {clearable && value && (
            <Button type="button" variant="ghost" size="sm" fullWidth className="mt-2" onClick={() => { onValueChange(null); setOpen(false); }}>
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
