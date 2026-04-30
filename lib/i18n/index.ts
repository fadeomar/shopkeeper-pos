import type { Locale, Direction, TranslationDict } from './types';
import { en } from './en';
import { ar } from './ar';

export type { Locale, Direction, TranslationDict };

const dictionaries: Record<Locale, TranslationDict> = { en, ar };

export function getDirection(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Reads a dot-separated key from the translation dictionary.
 * Falls back to English, then to the key itself if missing.
 */
function readKey(dict: TranslationDict, key: string): string {
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = dict;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return key;
    node = node[part];
  }
  return typeof node === 'string' ? node : key;
}

/**
 * Replaces {{variable}} placeholders in a string.
 */
function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    vars[name] !== undefined ? String(vars[name]) : `{{${name}}}`,
  );
}

/**
 * Returns a translation function bound to the given locale.
 * Usage: const t = getT('ar'); t('common.save') → "حفظ"
 */
export function getT(locale: Locale) {
  return function t(key: string, vars?: Record<string, string | number>): string {
    const dict = dictionaries[locale];
    let str = readKey(dict, key);
    // Fallback to English if the key resolves to itself (missing in ar)
    if (str === key && locale !== 'en') {
      str = readKey(en, key);
    }
    return interpolate(str === key ? key : str, vars);
  };
}
