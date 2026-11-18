/** What `Field` and `Input` know about a text field before choosing its keyboard defaults. */
export type FieldOptions = {
  /** The caller passed `onSubmit`. */
  submits: boolean;
  secureTextEntry?: boolean;
  multiline?: boolean;
  enterKeyHint?: string;
  returnKeyType?: string;
};

/**
 * The defaults `Field` (components/ui.tsx) and `Input` (screens/leagueUi.tsx) put under the caller's own
 * props:
 *
 * - A password field never capitalizes, autocorrects or spell-checks what is typed.
 * - A single-line field with `onSubmit` labels the keyboard's return key "done" unless the caller chose a
 *   label. A multiline field keeps Enter for new lines and never submits.
 * - In a browser, Enter leaves the focus in the field (react-native-web would blur it); on iPhone the
 *   keyboard goes away, except after "next", where the caller is about to focus the next field.
 */
export function fieldDefaults(options: FieldOptions, web: boolean) {
  const submits = options.submits && !options.multiline;
  const hint = options.enterKeyHint ?? options.returnKeyType;
  return {
    ...(options.secureTextEntry
      ? { autoCapitalize: "none" as const, autoCorrect: false, spellCheck: false }
      : null),
    ...(submits && !hint ? { enterKeyHint: "done" as const } : null),
    ...(submits && web ? { blurOnSubmit: false } : null),
    ...(submits && !web && hint === "next" ? { submitBehavior: "submit" as const } : null),
  };
}
