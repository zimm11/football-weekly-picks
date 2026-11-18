import { Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { space, type } from "../../components/theme";
import { colors } from "../../components/ui";
import { livesLeftLabel } from "../../lib/survivor";

/**
 * A player's lives as pips: one heart per life, filled for a life left and an outline for one lost, named
 * "1 of 2 lives left" for screen readers. `showLabel` writes the same words beside them. Never red: red is the
 * Pick of the Week's alone.
 */
export function LivesPips({
  left,
  lives,
  size = 16,
  showLabel = false,
}: {
  left: number;
  lives: number;
  size?: number;
  showLabel?: boolean;
}) {
  const label = livesLeftLabel(left, lives);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xxs }}>
        {Array.from({ length: lives }, (_, i) => (
          <Icon
            // biome-ignore lint/suspicious/noArrayIndexKey: the pips are positions, not items.
            key={i}
            name="heart"
            size={size}
            filled={i < left}
            weight={i < left ? "fill" : "regular"}
            color={i < left ? colors.foreground : colors.mutedForeground}
          />
        ))}
      </View>
      {showLabel && (
        <Text aria-hidden style={[type.caption, { color: colors.mutedForeground }]}>
          {label}
        </Text>
      )}
    </View>
  );
}
