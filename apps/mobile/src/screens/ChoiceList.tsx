import { type ComponentRef, useRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../components/Icon";
import { pressState } from "../components/pressState";
import { colors, fonts } from "../components/ui";
import { rovingTarget } from "../lib/rovingFocus";

export type Choice<T extends string> = { value: T; title: string; detail?: string; icon?: IconName };

/**
 * A short list of options shown in full, one to pick (a radio group): the league type cards and how a weekly
 * league is run. The chosen row takes the raised fill and a check, so it is never color alone.
 *
 * With a keyboard it is one stop, as a browser's radio group: Tab lands on the chosen option, the arrow keys
 * move to and choose the next one, and Space chooses the option that has the focus.
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
  const options = useRef<(ComponentRef<typeof View> | null)[]>([]);
  // The one option Tab stops on: the chosen one, or the first when nothing is chosen.
  const stop = Math.max(
    0,
    choices.findIndex((choice) => choice.value === value),
  );
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.mutedForeground }}>
        {label}
      </Text>
      <View role="radiogroup" aria-label={label} style={{ gap: 8 }}>
        {choices.map((choice, index) => {
          const selected = choice.value === value;
          return (
            <Pressable
              key={choice.value}
              ref={(node) => {
                options.current[index] = node;
              }}
              accessibilityRole="radio"
              accessibilityLabel={choice.title}
              accessibilityHint={choice.detail}
              accessibilityState={{ checked: selected, disabled }}
              aria-checked={selected}
              disabled={disabled}
              tabIndex={!disabled && index === stop ? 0 : -1}
              onPress={() => onChange(choice.value)}
              onKeyDown={
                Platform.OS === "web"
                  ? (event) => {
                      if (disabled) return;
                      const key = event.nativeEvent.key;
                      const target =
                        key === " "
                          ? index
                          : rovingTarget(
                              key,
                              index,
                              choices.map(() => true),
                            );
                      const next = target === undefined ? undefined : choices[target];
                      if (!next) return;
                      // Space must not scroll the page, nor the arrows.
                      event.preventDefault();
                      options.current[target ?? index]?.focus();
                      if (next.value !== value) onChange(next.value);
                    }
                  : undefined
              }
              style={(state) => {
                const { pressed, hovered } = pressState(state);
                return {
                  minHeight: 56,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: selected
                    ? hovered
                      ? colors.raisedHover
                      : colors.raised
                    : pressed || hovered
                      ? colors.raised
                      : colors.background,
                  opacity: disabled ? 0.5 : 1,
                };
              }}
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
