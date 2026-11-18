import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { colors, fonts } from "./theme";

export type DateTimeFieldProps = {
  /** The visible label and the field's accessible name ("Kickoff (Eastern time)"). */
  label: string;
  /** The accessible name when it should say more than the label ("Kickoff for KC at ATL"). */
  accessibilityLabel?: string;
  /**
   * A wall-clock date and time as text: `YYYY-MM-DD HH:mm` or `YYYY-MM-DDTHH:mm` (both are what
   * `parseLeagueKickoff` in `lib/leagueLogic.ts` reads), or "" when nothing is entered. It carries no time
   * zone: the caller decides whose clock it is (the league's).
   */
  value: string;
  /** The new text: what was typed on iPhone, `YYYY-MM-DDTHH:mm` (or "") from the browser's own picker. */
  onChangeText: (value: string) => void;
  editable?: boolean;
  /** Enter, or the keyboard's return key: submit the form the field is in. */
  onSubmit?: () => void;
};

/**
 * A date and time field. In a browser it is the browser's own `<input type="datetime-local">`
 * (DateTimeField.web.tsx): a real date and time picker on a phone, segments that take the arrow keys on a
 * computer. The iPhone app has no such control without a native module, so there it stays a text field for
 * `YYYY-MM-DD HH:mm`, with the number-and-punctuation keyboard and autocorrect, capitals and spell-check off so
 * the keyboard doesn't rewrite what was typed.
 */
export function DateTimeField({
  label,
  accessibilityLabel = label,
  value,
  onChangeText,
  editable = true,
  onSubmit,
}: DateTimeFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.mutedForeground }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Year, month, day, then the time on a 24-hour clock"
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        maxLength={16}
        onSubmitEditing={onSubmit ? () => onSubmit() : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          backgroundColor: colors.field,
          borderWidth: 1,
          borderColor: focused ? colors.primary : colors.input,
          borderRadius: 10,
          minHeight: 44,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 16,
          lineHeight: 24,
          color: colors.foreground,
          fontFamily: fonts.body,
          opacity: editable ? 1 : 0.6,
        }}
      />
    </View>
  );
}
