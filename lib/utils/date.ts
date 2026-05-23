export function nowIso() {
  return new Date().toISOString();
}

/**
 * Produces a YYYY-MM-DD key in the device's local timezone.
 * Use this instead of `new Date().toISOString().slice(0, 10)` which returns
 * a UTC date and will bucket midnight-to-2am sales into the previous day for
 * users in UTC+ timezones.
 */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(value));
}
