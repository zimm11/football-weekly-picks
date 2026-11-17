/** The native app has no browser history: its back gesture is guarded by `usePreventRemove`. */
export function guardBrowserHistory(_dirty: () => boolean, _ask: () => Promise<boolean>) {}
