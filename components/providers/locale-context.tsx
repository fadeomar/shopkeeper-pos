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

export const LOCALE_KEY = 'shopkeeper-pos-locale';
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'ar' || value === 'en';
}

function readCookieLocale(): Locale | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_KEY}=`));
  if (!cookie) return null;
  try {
    const value = decodeURIComponent(cookie.slice(LOCALE_KEY.length + 1));
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCookieLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_KEY}=${encodeURIComponent(locale)}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function readNavigatorLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

function readLocalStorageLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    // localStorage access can throw (SecurityError) in private/hardened modes
    // or when storage is blocked — never let that crash the boot effect.
    const stored = window.localStorage.getItem(LOCALE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  // Order: localStorage → cookie → navigator. The cookie fallback keeps the
  // saved language across refreshes even when localStorage is unavailable.
  return readLocalStorageLocale() ?? readCookieLocale() ?? readNavigatorLocale();
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage blocked — the cookie below still persists the choice.
  }
  writeCookieLocale(locale);
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

  // Read from localStorage/cookie and apply to document as early as possible.
  // The cookie fallback helps first paint and shortcut launches where browser
  // storage can be restored later than document metadata.
  useLayoutEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    persistLocale(stored);
    applyToDocument(stored);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
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
