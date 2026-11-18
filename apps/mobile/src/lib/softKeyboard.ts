/**
 * Web only (see `softKeyboard.web.ts`): whether a phone's on-screen keyboard is up for a text field. On iPhone
 * the keyboard covers the league's tab bar instead of pushing it up, so there is nothing to hide.
 */
export function useSoftKeyboardOpen(): boolean {
  return false;
}
