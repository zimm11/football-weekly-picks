// biome-ignore-all lint/correctness/noReactNativeRawText: Title, Label, Pill and Action render native Text.
import { BOARD_PHASE_LABEL, type BoardSummary, teamName } from "@picks/shared";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { AppLink } from "../../components/AppLink";
import { Icon } from "../../components/Icon";
import { hoverFill } from "../../components/pressState";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { TeamLogo } from "../../components/TeamLogo";
import { radius, space, tabular } from "../../components/theme";
import { colors, fonts, Title } from "../../components/ui";
import { request } from "../../lib/api";
import { boardsInOrder, boardTitle, scoreStatus } from "../../lib/squaresBoard";
import { kickoffDay, kickoffTime } from "../../lib/weekPresentation";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps, LeagueTypeScreens } from "../leagueTypeScreens";
import { Action, EmptyState, Failure, Label, Pill, s, useLeagueLoad } from "../leagueUi";
import { rememberBoardLeague } from "./boardLeague";

/**
 * Boards: every board the league holds, the ones still to finish first. A board opens on its own screen
 * (`/boards/:id`), and a commissioner starts a new one from here.
 */
export function SquaresBoardTab({ league, header, reload }: LeagueTabProps) {
  const path = `/leagues/${league.id}/boards`;
  const boards = useLeagueLoad(() => request<BoardSummary[]>(path), path, 30_000);
  // Each board's league, so a link to one that has since been deleted still has a way back here.
  useEffect(() => {
    for (const board of boards.data ?? []) rememberBoardLeague(board.id, league.id);
  }, [boards.data, league.id]);
  const admin = league.role === "admin";
  const empty = boards.data?.length === 0;
  const newBoard = (
    <Action compact icon="plus" href={`/boards/new?league=${league.id}`}>
      New board
    </Action>
  );
  return (
    <LeagueTabScroll header={header} reload={() => Promise.all([boards.refresh(), reload()])}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Title level={2}>Boards</Title>
        {/* Once the list is in: an empty league offers New board in its empty state instead, so it is one link. */}
        {admin && boards.data && !empty && newBoard}
      </View>
      <Failure message={boards.error} retry={boards.reload} />
      {!boards.data && !boards.error && (
        <View
          accessible
          accessibilityLabel="Loading boards"
          accessibilityState={{ busy: true }}
          style={s.card}
        >
          <SkeletonBlock width={96} height={18} radius={radius.full} />
          <SkeletonBlock width={220} height={26} />
          <SkeletonBlock width={160} height={16} />
        </View>
      )}
      {empty && (
        <EmptyState
          icon="grid"
          title="No boards yet"
          detail={
            admin
              ? "Set up the first board: the Super Bowl, any game, or one you type in."
              : "A commissioner will set up a board. You'll claim squares here."
          }
          action={
            admin ? (
              <Action
                compact
                icon="plus"
                href={`/boards/new?league=${league.id}`}
                style={{ alignSelf: "center" }}
              >
                New board
              </Action>
            ) : undefined
          }
        />
      )}
      {boardsInOrder(boards.data ?? []).map((board) => (
        <BoardCard key={board.id} board={board} timeZone={league.timeZone} />
      ))}
    </LeagueTabScroll>
  );
}

/** One board in the list, the whole card a link to it: its phase and kickoff, the game, and the squares taken. */
function BoardCard({ board, timeZone }: { board: BoardSummary; timeZone: string }) {
  return (
    <AppLink
      href={`/boards/${board.id}`}
      accessibilityLabel={`Open ${boardTitle(board, timeZone)}`}
      style={(state) => [s.card, { gap: 10, backgroundColor: hoverFill(state, colors.card) }]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pill inline tone={board.phase === "open" ? "primary" : board.phase === "final" ? "win" : "muted"}>
          {BOARD_PHASE_LABEL[board.phase]}
        </Pill>
        <Text numberOfLines={1} style={[s.muted, { flex: 1 }]}>
          {kickoffDay(board.kickoff, timeZone)}, {kickoffTime(board.kickoff, timeZone)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {/* The two badges overlap, away team in front, as the title reads. */}
        <View style={{ flexDirection: "row" }}>
          <TeamLogo team={board.awayTeam} size={32} />
          <View style={{ marginLeft: -8, zIndex: -1 }}>
            <TeamLogo team={board.homeTeam} size={32} />
          </View>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.subtitle, { fontSize: 22, lineHeight: 26 }]}>
            {teamName(board.awayTeam)} at {teamName(board.homeTeam)}
          </Text>
          <Label>
            {board.claimed} of 100 claimed
            {board.mine > 0 ? ` · ${board.mine} yours` : board.phase === "open" ? " · none yours yet" : ""}
          </Label>
          {board.phase === "open" && <ClaimMeter claimed={board.claimed} />}
          {board.latestScore && (
            <Text style={[s.muted, tabular]}>
              <Text style={{ fontFamily: fonts.semibold, color: colors.foreground }}>
                {scoreStatus(board.latestScore.period).status}
              </Text>
              {`  ${board.awayTeam} ${board.latestScore.away} · ${board.homeTeam} ${board.latestScore.home}`}
            </Text>
          )}
        </View>
        <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>
    </AppLink>
  );
}

/** How full an open board is: a thin bar under its count, decorative (the count says it in words). */
function ClaimMeter({ claimed }: { claimed: number }) {
  return (
    <View
      accessible={false}
      aria-hidden
      style={{
        height: 4,
        marginTop: space.xs,
        borderRadius: radius.full,
        backgroundColor: colors.raised,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${Math.min(100, Math.max(0, claimed))}%`,
          height: "100%",
          borderRadius: radius.full,
          backgroundColor: colors.primary,
        }}
      />
    </View>
  );
}

export const squaresScreens: LeagueTypeScreens = {
  tabs: { board: SquaresBoardTab },
  // A squares league lists its boards rather than seasons, and its commissioner's tools are on Boards.
  seasonSelector: false,
};
