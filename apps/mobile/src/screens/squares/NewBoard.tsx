// biome-ignore-all lint/correctness/noReactNativeRawText: Label, Pill, Heading and Action render native Text.
import {
  BOARD_PHASE_LABEL,
  type BoardSummary,
  DEFAULT_SQUARES_PER_PLAYER,
  MAX_SQUARES_PER_PLAYER,
  seasonYear,
} from "@picks/shared";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../../components/ui";
import { messageOf, request } from "../../lib/api";
import { now } from "../../lib/clock";
import { notifyDone } from "../../lib/notify";
import { boardTitle, type GameDraft, gameFromDraft, scheduleWeekAt } from "../../lib/squaresBoard";
import type { AdminToolsProps } from "../leagueTypeScreens";
import {
  Action,
  Card,
  Failure,
  go,
  Heading,
  Input,
  Label,
  Pill,
  s,
  useEditsGuard,
  useLeagueLoad,
} from "../leagueUi";
import { chooseBoard, setBoards } from "./boardChoice";
import { GameChooser } from "./GameChooser";

/** A new board's game: the Super Bowl, with "A game from the schedule" starting on this week's games. */
export const newGameDraft = (): GameDraft => ({
  source: "superbowl",
  year: seasonYear(now()),
  week: scheduleWeekAt(seasonYear(now()), now()),
  externalId: "",
  homeTeam: "",
  awayTeam: "",
  kickoff: "",
});

/** A whole number of squares per player in range, or null. */
export const parseLimit = (value: string) => {
  const n = Number(value);
  return /^\d+$/.test(value.trim()) && n >= 1 && n <= MAX_SQUARES_PER_PLAYER ? n : null;
};

/** Squares' admin tool on the League tab: New board, and the league's boards to manage. */
export function SquaresAdminTools({ league }: AdminToolsProps) {
  const boards = useLeagueLoad(
    () => request<BoardSummary[]>(`/leagues/${league.id}/boards`),
    `${league.id}:boards`,
  );
  const [draft, setDraft] = useState<GameDraft>(newGameDraft);
  const [limit, setLimit] = useState(String(DEFAULT_SQUARES_PER_PLAYER));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const changed =
    draft.source !== "superbowl" || limit !== String(DEFAULT_SQUARES_PER_PLAYER) || !!draft.kickoff;
  useEditsGuard(changed && !busy, () => {
    setDraft(newGameDraft());
    setLimit(String(DEFAULT_SQUARES_PER_PLAYER));
  });
  async function create() {
    if (busy) return;
    const { game, error: problem } = gameFromDraft(draft, league.timeZone);
    const maxPerPlayer = parseLimit(limit);
    if (problem) return setError(problem);
    if (maxPerPlayer === null) return setError(`Squares per player go from 1 to ${MAX_SQUARES_PER_PLAYER}.`);
    setBusy(true);
    setError(undefined);
    try {
      const created = await request<{ id: string }>(`/leagues/${league.id}/boards`, {
        method: "POST",
        body: { game, maxPerPlayer },
      });
      notifyDone("Board created.");
      setDraft(newGameDraft());
      setLimit(String(DEFAULT_SQUARES_PER_PLAYER));
      chooseBoard(league.id, created.id);
      const list = await request<BoardSummary[]>(`/leagues/${league.id}/boards`).catch(() => undefined);
      if (list) {
        boards.setData(list);
        setBoards(league.id, list);
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card label="Boards">
      <Heading>Boards</Heading>
      <Failure message={boards.error} retry={boards.reload} />
      {boards.data?.length === 0 && <Label>No boards yet. Set up the first one below.</Label>}
      {!!boards.data?.length && (
        <View>
          {boards.data.map((board) => (
            <Pressable
              key={board.id}
              accessibilityRole="link"
              accessibilityLabel={`Manage ${boardTitle(board, league.timeZone)}`}
              onPress={() => void go(`/boards/${board.id}/manage`)}
              style={({ pressed }) => ({
                minHeight: 56,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                backgroundColor: pressed ? colors.raised : "transparent",
              })}
            >
              <Text style={[s.subtitle, { fontSize: 20, flexShrink: 1 }]}>
                {boardTitle(board, league.timeZone)}
              </Text>
              <Pill inline tone={board.phase === "open" ? "primary" : "muted"}>
                {BOARD_PHASE_LABEL[board.phase]}
              </Pill>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
        <Heading>New board</Heading>
        <GameChooser
          leagueId={league.id}
          timeZone={league.timeZone}
          draft={draft}
          onChange={setDraft}
          disabled={busy}
        />
        <Input
          label="Squares per player"
          value={limit}
          onChangeText={setLimit}
          keyboardType="number-pad"
          editable={!busy}
        />
        <Label>It can be raised before the board locks, never lowered. Guest squares don't count.</Label>
        <Failure message={error} />
        <Action disabled={busy} onPress={() => void create()}>
          {busy ? "Creating…" : "Create board"}
        </Action>
      </View>
    </Card>
  );
}
