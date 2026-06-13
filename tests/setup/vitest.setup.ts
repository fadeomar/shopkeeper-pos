// Pin the timezone so date-boundary logic (today/yesterday/custom-range
// filters use local-day boundaries) is deterministic across developer
// machines and CI. Without this, instants like 2026-01-09T23:00Z fall on a
// different local calendar day depending on the runner's offset.
process.env.TZ = 'UTC';

import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetBodyScrollLock } from '@/lib/utils/body-scroll-lock';

// A few browser APIs are used by shell/UI modules but are not implemented by jsdom.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Cast through a loose alias so TS doesn't narrow `window` to `never` inside
// these "only define if missing" guards — lib.dom declares these APIs as
// always present on Window, even though jsdom doesn't implement them.
const browserGlobals = window as unknown as Record<string, unknown>;

if (!('ResizeObserver' in window)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  browserGlobals.ResizeObserver = ResizeObserverMock;
}

if (!('IntersectionObserver' in window)) {
  class IntersectionObserverMock {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  browserGlobals.IntersectionObserver = IntersectionObserverMock;
}


if (!('requestAnimationFrame' in window)) {
  browserGlobals.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 0);
}

if (!('cancelAnimationFrame' in window)) {
  browserGlobals.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
}

if (!('scrollTo' in window)) {
  browserGlobals.scrollTo = vi.fn();
}

// jsdom elements lack scrollIntoView; SearchableSelect (and other list UIs)
// call it whenever the highlighted option changes.
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  writable: true,
  configurable: true,
  value: vi.fn(),
});

HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

afterEach(() => {
  cleanup();
  resetBodyScrollLock();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  window.localStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
});
