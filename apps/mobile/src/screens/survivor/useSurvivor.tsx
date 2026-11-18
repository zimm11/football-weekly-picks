import type { SurvivorView } from "@picks/shared";
import { View } from "react-native";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { layout } from "../../components/theme";
import { request } from "../../lib/api";
import { s, useLeagueLoad } from "../leagueUi";

/**
 * A survivor season, refetched every minute while it shows (scores fill in, picks are revealed at kickoff, and
 * reading it takes the pool its next step) and whenever the screen comes back into focus.
 */
export function useSurvivor(leagueId: string, year: number) {
  return useLeagueLoad(
    () => request<SurvivorView>(`/leagues/${leagueId}/survivor?year=${year}`),
    `${leagueId}:${year}:survivor`,
    60_000,
  );
}

/** The survivor pool's placeholder: a title, then a card of rows, each a name and week cells, pulsing gently. */
export function SurvivorSkeleton({ label = "Loading the survivor pool" }: { label?: string }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ gap: layout.pageGap }}
    >
      <SkeletonBlock width={160} height={30} />
      <View style={[s.card, { gap: 10 }]}>
        {[0, 1, 2, 3, 4].map((row) => (
          <View key={row} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <SkeletonBlock width={120} height={28} />
            {[0, 1, 2, 3].map((cell) => (
              <SkeletonBlock key={cell} height={28} style={{ flex: 1 }} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
