/**
 * Shared body scroll lock for modal/sheet overlays.
 *
 * Multiple overlays can be open at once (mobile More sheet + confirm modal,
 * searchable select sheet + nested modal, etc.). A local "save previous
 * overflow and restore it" per component can leave `body { overflow:hidden }`
 * stuck after the last overlay closes. This tiny reference-counted helper keeps
 * scrolling reliable, which is critical for mobile checkout screens.
 */
let lockCount = 0;
let previousBodyOverflow = "";
let previousHtmlOverflow = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => undefined;

  if (lockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousHtmlOverflow = document.documentElement.style.overflow;
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
}
