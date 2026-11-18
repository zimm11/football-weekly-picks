import type { SurvivorView } from "@picks/shared";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { corner, radius, space, type } from "../../components/theme";
import { colors } from "../../components/ui";
import { request } from "../../lib/api";
import { listNames, recapSummary } from "../../lib/survivor";
import type { RecapProps } from "../leagueTypeScreens";
import { Action, go, Label, Sheet, s, useLeagueLoad } from "../leagueUi";
import { LivesPips } from "./LivesPips";

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
      <Text style={[type.cardTitle, { color: colors.foreground }]}>{recap.headline}</Text>
      {recap.wentOut && <Label>{recap.wentOut}</Label>}
      {recap.winners.length > 0 && (
        <Label>
          {recap.winners.length > 1
            ? `${listNames(recap.winners)} share the title.`
            : `${recap.winners[0]} won the pool.`}
        </Label>
      )}
      {/* One quiet line, not a tile stretched across the sheet: your lives, and how many are left. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: space.lg,
          backgroundColor: colors.raised,
          ...corner(radius.lg),
          paddingHorizontal: space.lg,
          paddingVertical: space.md + space.xxs,
        }}
      >
        {recap.lives && <LivesPips left={recap.lives.left} lives={recap.lives.of} showLabel />}
        <Text style={[s.text, { fontFamily: type.cardTitle.fontFamily }]}>
          {`${recap.left} of ${recap.total} still in`}
        </Text>
      </View>
      <Action
        href={`/leagues/${leagueId}/standings`}
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
