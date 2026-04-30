'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { getDirection, getT, type Locale, type Direction } from '@/lib/i18n';

const LOCALE_KEY = 'shopkeeper-pos-locale';

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LOCALE_KEY);
  return stored === 'ar' ? 'ar' : 'en';
}

function applyToDocument(locale: Locale) {
  const dir: Direction = getDirection(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
}

interface LocaleContextValue {
  locale: Locale;
  dir: Direction;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  dir: 'ltr',
  t: (key) => key,
  setLocale: () => undefined,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Read from localStorage and apply to document as early as possible
  useLayoutEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    applyToDocument(stored);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(LOCALE_KEY, next);
    applyToDocument(next);
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    dir: getDirection(locale),
    t: getT(locale),
    setLocale,
  }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
