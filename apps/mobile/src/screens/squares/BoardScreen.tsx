import { ScrollView } from "react-native";
import { ComingSoon } from "../ComingSoon";
import { s } from "../leagueUi";

/** `/boards/:id`: one squares board as every member sees it. Placeholder. */
export function BoardScreen(_: { boardId: string }) {
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <ComingSoon title="Squares board" />
    </ScrollView>
  );
}

/** `/boards/:id/manage`: the admin's board screen (game, limit, guest squares, Lock and draw, scores). Placeholder. */
export function ManageBoardScreen(_: { boardId: string }) {
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <ComingSoon title="Manage board" />
    </ScrollView>
  );
}
