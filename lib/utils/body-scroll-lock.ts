/**
 * Shared body scroll lock for modal/sheet overlays.
 *
 * This helper is intentionally defensive. A POS checkout screen becoming
 * unscrollable is a blocking bug, so the lock is reference-counted, marks the
 * document with an attribute while active, and exposes a stale-lock guard for
 * the app shell. If a modal unmounts unexpectedly, the guard can safely restore
 * scrolling as soon as no visible modal/sheet remains.
 */
const SCROLL_LOCK_ATTR = "data-asas-scroll-locked";

let lockCount = 0;
let previousBodyOverflow = "";
let previousHtmlOverflow = "";

function setLockAttribute(locked: boolean): void {
  if (typeof document === "undefined") return;
  if (locked) {
    document.documentElement.setAttribute(SCROLL_LOCK_ATTR, "true");
    document.body.setAttribute(SCROLL_LOCK_ATTR, "true");
  } else {
    document.documentElement.removeAttribute(SCROLL_LOCK_ATTR);
    document.body.removeAttribute(SCROLL_LOCK_ATTR);
  }
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function hasVisibleBlockingOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
    isVisibleElement,
  );
}

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => undefined;

  if (lockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousHtmlOverflow = document.documentElement.style.overflow;
    setLockAttribute(true);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }

  lockCount += 1;
  let released = false;

  return () => {
    if (released || typeof document === "undefined") return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      previousBodyOverflow = "";
      previousHtmlOverflow = "";
      setLockAttribute(false);
    }
  };
}

export function resetBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  lockCount = 0;
  previousBodyOverflow = "";
  previousHtmlOverflow = "";
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  setLockAttribute(false);
}

export function resetBodyScrollLockIfStale(): void {
  if (typeof document === "undefined") return;
  const maybeLocked =
    lockCount > 0 ||
    document.body.style.overflow === "hidden" ||
    document.documentElement.style.overflow === "hidden" ||
    document.body.hasAttribute(SCROLL_LOCK_ATTR) ||
    document.documentElement.hasAttribute(SCROLL_LOCK_ATTR);

  if (maybeLocked && !hasVisibleBlockingOverlay()) {
    resetBodyScrollLock();
  }
}
