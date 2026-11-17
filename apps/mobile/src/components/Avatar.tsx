import { Text, View } from "react-native";
import { colors, fonts } from "./theme";

/** A player's initials, as their avatar shows them. */
export function avatarInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    (words[0]?.[0] ?? "?") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : (words[0]?.[1] ?? ""))
  ).toUpperCase();
}

/** A player's avatar color, the same for their name everywhere (a squares cell uses it too). */
export function avatarColor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors.avatars[Math.abs(hash) % colors.avatars.length];
}

export function Avatar({ name, size = 32 }: { name: string; size?: number | "sm" | "md" }) {
  const diameter = typeof size === "number" ? size : size === "sm" ? 24 : 32;
  return (
    <View
      accessible={false}
      aria-hidden
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        backgroundColor: avatarColor(name),
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Text
        style={{ fontFamily: fonts.semibold, fontSize: diameter * 0.375, color: colors.avatarForeground }}
      >
        {avatarInitials(name)}
      </Text>
    </View>
  );
}
