/**
 * The iPhone app has no browser history: a sheet, dialog or menu closes on Android's hardware back through its
 * `Modal`'s `onRequestClose`, and nothing else is needed. The web version is `overlayBack.web.ts`.
 */
export function useOverlayBack(_open: boolean, _close: () => void) {}
