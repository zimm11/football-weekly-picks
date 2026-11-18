import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "./Icon";
import { pressState } from "./pressState";
import { colors, fonts } from "./ui";
export function PreferenceToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
  small = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  /** A plain 14px label, as web's inline checkboxes ("Auto-fill games and spreads"). */
  small?: boolean;
}) {
  // Shows the tap at once, as a browser checkbox does, while the parent saves; the saved value then takes over.
  const [pending, setPending] = useState<boolean>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new saved value, or the save finishing, ends the pending state.
  useEffect(() => {
    if (!disabled) setPending(undefined);
  }, [checked, disabled]);
  const shown = pending ?? checked;
  function toggle() {
    setPending(!shown);
    onChange(!shown);
  }
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: shown, disabled }}
      // react-native-web reads only the aria-* form.
      aria-checked={shown}
      disabled={disabled}
      onPress={toggle}
      // Space ticks a checkbox. react-native-web presses on Enter only (Space is for buttons), and the page
      // must not scroll instead.
      onKeyDown={(event) => {
        if (event.nativeEvent.key !== " " || disabled) return;
        event.preventDefault();
        toggle();
      }}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 4,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      {(state) => (
        <>
          <View
            style={{
              width: 20,
              height: 20,
              marginTop: 1,
              borderRadius: 4,
              backgroundColor: shown
                ? colors.primary
                : pressState(state).hovered
                  ? colors.raised
                  : colors.background,
              borderColor: shown || pressState(state).hovered ? colors.primary : colors.input,
              borderWidth: 1,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {shown && <Icon name="check" size={14} color={colors.primaryForeground} />}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              style={{
                fontFamily: small ? fonts.body : fonts.medium,
                fontSize: small ? 14 : 16,
                lineHeight: small ? 20 : undefined,
                color: colors.foreground,
              }}
            >
              {label}
            </Text>
            {description && (
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 14,
                  lineHeight: 20,
                  color: colors.mutedForeground,
                }}
              >
                {description}
              </Text>
            )}
          </View>
        </>
      )}
    </Pressable>
  );
}
