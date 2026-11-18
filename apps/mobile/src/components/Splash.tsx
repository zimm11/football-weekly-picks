import { Text, View } from "react-native";
import { colors, fonts } from "./ui";

/**
 * The POW mark over the whole screen while the app opens, greeting the player by name once it is known.
 * `public/boot-mark.png` (drawn by `scripts/icons.mjs boot-mark`) is the same mark in the same place, shown by
 * `public/boot.css` before the app's scripts run: change one and redraw the other.
 *
 * `status` is the "Getting your leagues ready…" line: off until there is a session to get leagues for (a
 * signed-out visitor has none). Its place is kept either way, so the mark never moves.
 */
export function Splash({ name, status = true }: { name?: string; status?: boolean }) {
  const first = name?.trim().split(/\s+/)[0];
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Opening POW Pick'em"
      style={{
        flex: 1,
        minHeight: 360,
        backgroundColor: colors.chrome,
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <View style={{ gap: 26, alignItems: "center" }}>
        <View style={{ alignItems: "stretch" }}>
          <Text
            style={{
              fontFamily: fonts.displayExtraBold,
              fontSize: 140,
              lineHeight: 128,
              color: colors.foreground,
              letterSpacing: 1,
            }}
          >
            POW
          </Text>
          <View style={{ height: 10, backgroundColor: colors.pow, marginTop: 8 }} />
          <Text
            style={{
              fontFamily: fonts.displayBold,
              fontSize: 24,
              color: colors.mutedForeground,
              letterSpacing: 9,
              textAlign: "center",
              marginTop: 16,
            }}
          >
            PICK'EM
          </Text>
        </View>
        <View style={{ gap: 6, alignItems: "center", minHeight: 56 }}>
          {first && (
            <Text
              style={{
                fontFamily: fonts.displayBold,
                fontSize: 24,
                color: colors.foreground,
                textTransform: "uppercase",
              }}
            >
              Welcome back, {first}
            </Text>
          )}
          {status && (
            <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.mutedForeground }}>
              Getting your leagues ready…
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
