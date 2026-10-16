import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Testing Library only registers this itself when the runner exposes a global
// afterEach, and this project keeps Vitest globals off.
afterEach(cleanup)

// jsdom implements none of these, and MUI reaches for all three: useMediaQuery
// for breakpoints, ResizeObserver when a Select opens its popover, and
// IntersectionObserver for the lazy-mounted chart panels. Files that opt into
// the node environment have no window at all, so this block is skipped there.
if (typeof window !== 'undefined') {
  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = window.ResizeObserver ?? (NoopObserver as unknown as typeof ResizeObserver)
  window.IntersectionObserver =
    window.IntersectionObserver ?? (NoopObserver as unknown as typeof IntersectionObserver)
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as unknown as MediaQueryList
}
