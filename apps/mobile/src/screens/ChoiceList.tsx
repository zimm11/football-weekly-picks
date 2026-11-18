import { type ComponentRef, type ReactNode, useRef } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Icon, type IconName } from "../components/Icon";
import { disabledOpacity, pressTile } from "../components/pressState";
import { corner, radius, space, type } from "../components/theme";
import { colors, fonts, styles as uiStyles } from "../components/ui";
import { haptics } from "../lib/haptics";
import { webTransition } from "../lib/motion";
import { rovingTarget } from "../lib/rovingFocus";

export type Choice<T extends string> = { value: T; title: string; detail?: string; icon?: IconName };

/** The narrowest window that lays a `columns` list out across: below it, one card per row. */
const COLUMNS_FROM = 560;

/**
 * A short list of options shown in full, one to pick (a radio group): the league type cards and how a weekly
 * league is run. The chosen row takes the raised fill and a check, so it is never color alone.
 *
 * With a keyboard it is one stop, as a browser's radio group: Tab lands on the chosen option, the arrow keys
 * move to and choose the next one, and Space chooses the option that has the focus.
 *
 * `columns` lays the cards out that many across in a window at least 560px wide (one per row below that);
 * the arrow keys still move through them in order. `action` sits at the right end of the label's row.
 */
export function ChoiceList<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled,
  columns = 1,
  action,
}: {
  label: string;
  value: T;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
  action?: ReactNode;
}) {
  const options = useRef<(ComponentRef<typeof View> | null)[]>([]);
  const { width } = useWindowDimensions();
  const across = width >= COLUMNS_FROM ? columns : 1;
  // The one option Tab stops on: the chosen one, or the first when nothing is chosen.
  const stop = Math.max(
    0,
    choices.findIndex((choice) => choice.value === value),
  );
  const choose = (next: T) => {
    if (next === value) return;
    haptics.select();
    onChange(next);
  };
  const option = (choice: Choice<T>, index: number) => {
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
        onPress={() => choose(choice.value)}
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
                choose(next.value);
              }
            : undefined
        }
        style={(state) => [
          webTransition(["background-color", "opacity", "transform"]),
          {
            minHeight: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: space.lg,
            padding: space.lg,
            ...corner(radius.lg),
            backgroundColor: selected ? colors.raised : colors.background,
            opacity: disabled ? disabledOpacity : 1,
          },
          across > 1 && { flex: 1, minWidth: 0 },
          !disabled && pressTile(state, selected),
        ]}
      >
        {choice.icon && (
          <Icon
            name={choice.icon}
            size={24}
            filled={selected}
            color={selected ? colors.primary : colors.mutedForeground}
          />
        )}
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text style={[type.body, { fontFamily: fonts.semibold, color: colors.foreground }]}>
            {choice.title}
          </Text>
          {choice.detail && (
            <Text style={[type.small, { color: colors.mutedForeground }]}>{choice.detail}</Text>
          )}
        </View>
        {selected && <Icon name="check-circle" size={20} color={colors.primary} />}
      </Pressable>
    );
  };
  // Rows of `across` cards; the last row is padded with empty space so every card keeps the same width.
  const rows: Choice<T>[][] = [];
  for (let i = 0; i < choices.length; i += across) rows.push(choices.slice(i, i + across));
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={[uiStyles.label, { flexShrink: 1 }]}>{label}</Text>
        {action}
      </View>
      <View role="radiogroup" aria-label={label} style={{ gap: space.md }}>
        {across === 1
          ? choices.map(option)
          : rows.map((row, r) => (
              <View key={row[0]?.value ?? r} style={{ flexDirection: "row", gap: space.md }}>
                {row.map((choice, c) => option(choice, r * across + c))}
                {Array.from({ length: across - row.length }, (_, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: empty fillers, all alike.
                  <View key={`filler-${n}`} aria-hidden style={{ flex: 1 }} />
                ))}
              </View>
            ))}
      </View>
    </View>
  );
}
