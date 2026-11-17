import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../components/Icon";
import { colors, fonts } from "../components/ui";

export type Choice<T extends string> = { value: T; title: string; detail?: string; icon?: IconName };

/**
 * A short list of options shown in full, one to pick (a radio group): the league type cards and how a weekly
 * league is run. The chosen row takes the raised fill and a check, so it is never color alone.
 */
export function ChoiceList<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.mutedForeground }}>
        {label}
      </Text>
      <View role="radiogroup" aria-label={label} style={{ gap: 8 }}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <Pressable
              key={choice.value}
              accessibilityRole="radio"
              accessibilityLabel={choice.title}
              accessibilityHint={choice.detail}
              accessibilityState={{ checked: selected, disabled }}
              aria-checked={selected}
              disabled={disabled}
              onPress={() => onChange(choice.value)}
              style={({ pressed }) => ({
                minHeight: 56,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: selected ? colors.raised : pressed ? colors.raised : colors.background,
                opacity: disabled ? 0.5 : 1,
              })}
            >
              {choice.icon && (
                <Icon
                  name={choice.icon}
                  size={24}
                  filled={selected}
                  color={selected ? colors.primary : colors.mutedForeground}
                />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.foreground }}>
                  {choice.title}
                </Text>
                {choice.detail && (
                  <Text
                    style={{
                      fontFamily: fonts.body,
                      fontSize: 14,
                      lineHeight: 20,
                      color: colors.mutedForeground,
                    }}
                  >
                    {choice.detail}
                  </Text>
                )}
              </View>
              {selected && <Icon name="check-circle" size={20} color={colors.primary} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
