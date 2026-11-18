import { Text, View } from "react-native";
import type { DateTimeFieldProps } from "./DateTimeField";
import { colors, fonts } from "./theme";

export type { DateTimeFieldProps };

/** What `<input type="datetime-local">` takes: `YYYY-MM-DDTHH:mm`. Anything else shows as empty. */
export function toDateTimeLocal(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/.exec(value.trim());
  return match ? `${match[1]}T${match[2]}` : "";
}

/**
 * See DateTimeField.tsx. The browser's own date and time control, styled as the app's text fields are. Its
 * value is always `YYYY-MM-DDTHH:mm` or "" (a half-entered date reads as ""), so the caller's parser never sees
 * a partial one. The text is 16px: iOS Safari zooms the page when a control with smaller text takes focus.
 */
export function DateTimeField({
  label,
  accessibilityLabel = label,
  value,
  onChangeText,
  editable = true,
  onSubmit,
}: DateTimeFieldProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.mutedForeground }}>
        {label}
      </Text>
      <input
        type="datetime-local"
        aria-label={accessibilityLabel}
        value={toDateTimeLocal(value)}
        disabled={!editable}
        onChange={(event) => onChangeText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          display: "block",
          boxSizing: "border-box",
          width: "100%",
          minWidth: 0,
          minHeight: 44,
          margin: 0,
          padding: "10px 12px",
          borderRadius: 10,
          border: `1px solid ${colors.input}`,
          backgroundColor: `${colors.background}99`,
          color: colors.foreground,
          colorScheme: "dark",
          fontFamily: fonts.body,
          fontSize: 16,
          lineHeight: "22px",
          textAlign: "left",
          opacity: editable ? 1 : 0.6,
        }}
      />
    </View>
  );
}
