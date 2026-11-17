import type { SurvivorView } from "@picks/shared";
import { View } from "react-native";
import { request } from "../../lib/api";
import { colors, s, useLeagueLoad } from "../leagueUi";

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

/** The survivor grid's placeholder: a header line, then rows of a name and week cells. */
export function SurvivorSkeleton({ label = "Loading the survivor pool" }: { label?: string }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} style={{ gap: 12 }}>
      <View style={{ width: 160, height: 24, borderRadius: 6, backgroundColor: colors.raised }} />
      <View style={[s.card, { gap: 10 }]}>
        {[0, 1, 2, 3, 4].map((row) => (
          <View key={row} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={{ width: 120, height: 28, borderRadius: 6, backgroundColor: colors.raised }} />
            {[0, 1, 2, 3].map((cell) => (
              <View
                key={cell}
                style={{ flex: 1, height: 28, borderRadius: 6, backgroundColor: colors.raised }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
