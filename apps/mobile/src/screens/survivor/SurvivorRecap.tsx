import type { SurvivorView } from "@picks/shared";
import { useEffect } from "react";
import { View } from "react-native";
import { request } from "../../lib/api";
import { listNames, recapSummary } from "../../lib/survivor";
import type { RecapProps } from "../leagueTypeScreens";
import { Action, go, Label, Sheet, StatTile, useLeagueLoad } from "../leagueUi";

/**
 * The bottom sheet after a survivor week is final, once per player: whether they're still in, who went out, and
 * how many are left (the winner too, when the pool ended that week).
 */
export function SurvivorRecap({ weekId, userId, leagueId, close }: RecapProps) {
  const season = useLeagueLoad(
    () => request<SurvivorView>(`/leagues/${leagueId}/survivor`),
    `${leagueId}:${weekId}:recap`,
  );
  const recap = season.data ? recapSummary(season.data, weekId, userId) : null;
  const shown = !!recap;
  useEffect(() => {
    if (shown) void request(`/weeks/${weekId}/recap/seen`, { method: "POST" }).catch(() => {});
  }, [shown, weekId]);
  if (!recap) return null;
  return (
    <Sheet title={recap.title} close={close} closeButton={false}>
      <Label>{recap.headline}</Label>
      {recap.wentOut && <Label>{recap.wentOut}</Label>}
      {recap.winners.length > 0 && (
        <Label>
          {recap.winners.length > 1
            ? `${listNames(recap.winners)} share the title.`
            : `${recap.winners[0]} won the pool.`}
        </Label>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <StatTile label="Still in" value={recap.left} detail={`of ${recap.total}`} />
      </View>
      <Action
        link
        onPress={() => {
          close();
          void go(`/leagues/${leagueId}/standings`);
        }}
      >
        See who's left
      </Action>
      <Action secondary onPress={close}>
        Close
      </Action>
    </Sheet>
  );
}
