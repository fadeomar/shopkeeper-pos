import type { KeyboardEvent } from "react";

/**
 * Mobile keyboards keep the on-screen keyboard up after the user taps the
 * Enter / "done" / ✓ key because nothing blurs the field. These helpers blur
 * the input on Enter so the keyboard dismisses. They intentionally do NOT
 * submit anything — saving stays an explicit button tap.
 *
 * Textareas are left alone (Enter inserts a newline there).
 */

/** Attach to a single input's `onKeyDown`. */
export function dismissOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

/**
 * Attach to a container (e.g. a modal/form body) `onKeyDown` to cover every
 * `<input>` inside it at once — blurs whichever input fired Enter.
 */
export function blurInputOnEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
    e.preventDefault();
    e.target.blur();
  }
}
