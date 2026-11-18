// biome-ignore-all lint/correctness/noReactNativeRawText: Label, Pill, Heading and Action render native Text.
import {
  DEFAULT_SQUARES_PER_PLAYER,
  type LeagueDetail,
  MAX_SQUARES_PER_PLAYER,
  seasonYear,
} from "@picks/shared";
import { router, useNavigation } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { NotFound } from "../../components/NotFound";
import { messageOf, request } from "../../lib/api";
import { now } from "../../lib/clock";
import { notifyDone } from "../../lib/notify";
import { usePageTitle } from "../../lib/pageTitle";
import { type GameDraft, gameFromDraft, scheduleWeekAt } from "../../lib/squaresBoard";
import { Action, Card, Failure, Heading, Input, Label, s, useEditsGuard, useLeagueLoad } from "../leagueUi";
import { BoardFrame } from "./BoardFrame";
import { GameChooser } from "./GameChooser";

/** `/leagues/:id/boards/new`: a commissioner sets up a board, then lands on it. */
export function NewBoardScreen({ leagueId }: { leagueId: string }) {
  const loaded = useLeagueLoad(() => request<LeagueDetail>(`/leagues/${leagueId}`), `/leagues/${leagueId}`);
  const league = loaded.data;
  // Not the player's league, or not a squares league: there is no such page.
  const missing = league ? league.type !== "squares" : loaded.status === 404;
  usePageTitle(missing ? "Page not found" : league ? `New board · ${league.name}` : "New board");
  if (missing) return <NotFound />;
  return (
    <BoardFrame league={league} reload={loaded.refresh}>
      {!league ? (
        loaded.error ? (
          <Failure message={loaded.error} retry={loaded.reload} />
        ) : (
          <View
            accessible
            accessibilityLabel="Loading league"
            accessibilityState={{ busy: true }}
            style={[s.card, { height: 320 }]}
          />
        )
      ) : league.role !== "admin" ? (
        <Card>
          <Heading>New board</Heading>
          <Label>Only league commissioners can set up a board.</Label>
          <Action href={`/leagues/${leagueId}`} how="replace">
            Go to the boards
          </Action>
        </Card>
      ) : (
        <NewBoardForm league={league} />
      )}
    </BoardFrame>
  );
}

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

/** The form: the game (the Super Bowl unless another is chosen) and how many squares each player may hold. */
function NewBoardForm({ league }: { league: LeagueDetail }) {
  const navigation = useNavigation();
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
      if (navigation.isFocused()) router.replace(`/boards/${created.id}` as never);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card label="New board">
      <Heading>New board</Heading>
      <View style={{ gap: 12 }}>
        <GameChooser
          leagueId={league.id}
          timeZone={league.timeZone}
          draft={draft}
          // A message about the form ("Choose both teams.") goes once the form changes: it may no longer be true.
          onChange={(next) => {
            setDraft(next);
            setError(undefined);
          }}
          disabled={busy}
          onSubmit={() => void create()}
        />
        <Input
          label="Squares per player"
          value={limit}
          onChangeText={(value) => {
            setLimit(value);
            setError(undefined);
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={3}
          editable={!busy}
          onSubmit={() => void create()}
        />
        <Label>It can be raised before the board locks, never lowered. Guest squares don't count.</Label>
        <Failure message={error} />
        <Action busy={busy} onPress={() => void create()}>
          {busy ? "Creating…" : "Create board"}
        </Action>
      </View>
    </Card>
  );
}
