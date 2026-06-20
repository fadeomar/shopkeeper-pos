'use client';

import { useEffect, useState } from 'react';

function readStoredValue<T>(key: string, fallback: T, enabled: boolean): T {
  if (!enabled || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function usePersistedState<T>(
  key: string,
  fallback: T,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const [value, setValue] = useState<T>(() => readStoredValue(key, fallback, enabled));

  useEffect(() => {
    if (!enabled) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in private mode or during quota errors.
      // Keep the in-memory state so the UI behavior remains unchanged.
    }
  }, [enabled, key, value]);

  return [value, setValue] as const;
}
