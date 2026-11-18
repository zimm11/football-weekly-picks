// biome-ignore-all lint/correctness/noReactNativeRawText: Label, Pill, Heading, Eyebrow and Action render native Text.
import { BOARD_PHASE_LABEL, type BoardSquare, type BoardView, teamName } from "@picks/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { colors, fonts } from "../../components/ui";
import { messageOf, request } from "../../lib/api";
import { offerHomeScreen } from "../../lib/homeScreen";
import { notifyError } from "../../lib/notify";
import {
  claimRoom,
  type PendingChange,
  quarterRows,
  randomOpenSquare,
  squarePlace,
  winsOf,
  winsText,
  withPending,
} from "../../lib/squaresBoard";
import { kickoffDay, kickoffTime } from "../../lib/weekPresentation";
import { Action, Card, Eyebrow, Failure, Heading, Label, Pill, Sheet, s, useLeagueLoad } from "../leagueUi";
import { rememberBoardLeague } from "./boardChoice";
import { BoardSkeleton, SquaresGrid } from "./SquaresGrid";

/** Loads one board, refetching until it is final: every 30 s while open, every minute once locked. */
export function useBoard(boardId: string) {
  const [every, setEvery] = useState(30_000);
  const board = useLeagueLoad(() => request<BoardView>(`/boards/${boardId}`), boardId, every);
  const phase = board.data?.phase;
  useEffect(() => {
    if (phase) setEvery(phase === "final" ? 0 : phase === "open" ? 30_000 : 60_000);
  }, [phase]);
  // Which league the board is in, so a link to it that has gone stale still has a way back there.
  const leagueId = board.data?.leagueId;
  useEffect(() => {
    if (leagueId) rememberBoardLeague(boardId, leagueId);
  }, [boardId, leagueId]);
  return board;
}

/**
 * Claims and releases a square at once, filling the cell before the API answers. Requests go one at a time, so
 * each answer is the board after every earlier one; a refusal undoes that change and says why (notifyError).
 */
export function useSquareChanges(boardId: string, setData: (view: BoardView) => void, reload: () => void) {
  const [pending, setPending] = useState<PendingChange[]>([]);
  const queue = useRef(Promise.resolve());
  function send(change: PendingChange, guestName?: string) {
    setPending((list) => [...list, change]);
    queue.current = queue.current.then(async () => {
      try {
        const path = `/boards/${boardId}/squares/${change.row}/${change.col}`;
        const next = await request<BoardView>(
          path,
          change.claim ? { method: "PUT", body: guestName ? { guestName } : {} } : { method: "DELETE" },
        );
        setData(next);
        // The first claimed square is a good moment to suggest the home screen (shown once, in a browser).
        if (change.claim && !guestName) offerHomeScreen("square");
      } catch (err) {
        notifyError(messageOf(err));
        reload();
      } finally {
        setPending((list) => list.filter((item) => item !== change));
      }
    });
  }
  return { pending, send };
}

/** One board as every member sees it: the grid, your squares, the quarter results and who holds squares. */
export function BoardPanel({
  boardId,
  board,
  userId,
  displayName,
  avatarId,
  header,
  standalone,
}: {
  boardId: string;
  /** The board as `useBoard` loads it. */
  board: ReturnType<typeof useBoard>;
  userId: string;
  displayName: string;
  avatarId?: number | null;
  /** Shown above the board once it has loaded (a standalone screen's league header). */
  header?: (view: BoardView) => ReactNode;
  /** On `/boards/:id` rather than in the Board tab: Manage board takes this screen's place in history. */
  standalone?: boolean;
}) {
  const changes = useSquareChanges(boardId, board.setData, board.reload);
  const [sheet, setSheet] = useState<{ row: number; col: number } | null>(null);
  if (!board.data) {
    return board.error ? <Failure message={board.error} retry={board.reload} /> : <BoardSkeleton />;
  }
  const view = board.data;
  const squares = withPending(view.squares, changes.pending);
  const mine = squares.filter((sq) => sq.userId === userId).length;
  const room = claimRoom({ ...view, mine, claimed: squares.length });
  function claim(row: number, col: number) {
    if (room.left === 0) {
      notifyError(
        `You can hold ${view.maxPerPlayer} ${view.maxPerPlayer === 1 ? "square" : "squares"} on this board.`,
      );
      return;
    }
    changes.send({ row, col, claim: true, name: displayName, avatarId, userId });
  }
  function tap(row: number, col: number, square: BoardSquare | undefined) {
    if (room.open && !square) return claim(row, col);
    if (room.open && square?.userId === userId) {
      return changes.send({ row, col, claim: false, name: displayName, userId });
    }
    setSheet({ row, col });
  }
  const shown = sheet ? squares.find((sq) => sq.row === sheet.row && sq.col === sheet.col) : undefined;
  return (
    <View style={{ gap: 20 }}>
      {header?.(view)}
      <BoardHeading view={view} admin={view.role === "admin"} standalone={standalone} />
      <Failure message={board.error} retry={board.reload} />
      <SquaresGrid view={view} squares={squares} userId={userId} onPress={tap} />
      {room.open && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Action
            secondary
            icon="grid"
            disabled={room.left === 0}
            onPress={() => {
              const open = randomOpenSquare(squares);
              if (open) claim(open.row, open.col);
            }}
          >
            Claim a random square
          </Action>
          <Label>Tap an open square to claim it, and yours to give it back, until the board locks.</Label>
        </View>
      )}
      <BoardDetails view={view} squares={squares} mine={mine} userId={userId} />
      {sheet && (
        <SquareSheet
          view={view}
          row={sheet.row}
          col={sheet.col}
          square={shown}
          close={() => setSheet(null)}
        />
      )}
    </View>
  );
}

/**
 * The board's heading: its phase, the game and the kickoff, and for an admin the way to the other board screen.
 * On a phone it is two short rows (phase and kickoff, then the game on one line) so the grid starts higher up.
 * `standalone`: on `/boards/:id` or its manage screen, where the link swaps one for the other in place, so going
 * back and forth between them doesn't pile up history.
 */
export function BoardHeading({
  view,
  admin,
  manage,
  standalone = !!manage,
}: {
  view: BoardView;
  admin: boolean;
  manage?: boolean;
  standalone?: boolean;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 560;
  const title = manage ? "Manage board" : `${teamName(view.awayTeam)} at ${teamName(view.homeTeam)}`;
  const when = `${manage ? `${view.awayTeam} at ${view.homeTeam} · ` : ""}${kickoffDay(view.kickoff, view.timeZone)}, ${kickoffTime(view.kickoff, view.timeZone)}`;
  const pills = (
    <>
      <Pill
        inline={phone}
        tone={view.phase === "open" ? "primary" : view.phase === "final" ? "win" : "muted"}
      >
        {BOARD_PHASE_LABEL[view.phase]}
      </Pill>
      {view.live && (
        <Pill inline={phone} tone="win">
          {`Now ${view.awayTeam} ${view.live.awayScore} · ${view.homeTeam} ${view.live.homeScore}`}
        </Pill>
      )}
    </>
  );
  const link =
    admin &&
    (manage ? (
      <Action secondary compact href={`/boards/${view.id}`} how="replace">
        View board
      </Action>
    ) : (
      <Action secondary compact href={`/boards/${view.id}/manage`} how={standalone ? "replace" : "push"}>
        Manage board
      </Action>
    ));
  if (phone) {
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {pills}
            <Text style={[s.muted, { flexShrink: 1 }]}>{when}</Text>
          </View>
          {link}
        </View>
        {/* One line: the type steps down for a long pair of names instead of wrapping. */}
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={[s.title, boardTitleSize(title, width)]}
        >
          {title}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
      <View style={{ gap: 6, flex: 1, minWidth: 220 }}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{pills}</View>
        <Text accessibilityRole="header" style={s.title}>
          {title}
        </Text>
        <Label>{when}</Label>
      </View>
      {link}
    </View>
  );
}

/**
 * The title's size on a phone, so "BUCCANEERS AT COMMANDERS" stays on one line at 320px: the condensed capitals
 * run about 0.5 of the font size each, in the width left inside the page's 16px gutters.
 */
function boardTitleSize(title: string, width: number) {
  const fontSize = Math.max(20, Math.min(32, Math.floor((width - 32) / (title.length * 0.5))));
  return { fontSize, lineHeight: fontSize + 2 };
}

/** Under the grid: your squares against your limit, the four quarter results, and who holds squares. */
export function BoardDetails({
  view,
  squares,
  mine,
  userId,
}: {
  view: BoardView;
  squares: BoardSquare[];
  mine: number;
  userId: string;
}) {
  const stacked = useWindowDimensions().width < 560;
  return (
    <>
      <Card label="Your squares">
        <Eyebrow>Your squares</Eyebrow>
        <Text
          style={{ fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32, color: colors.foreground }}
        >
          {mine} of {view.maxPerPlayer}
        </Text>
        <Label>
          {squares.length} of 100 squares claimed
          {view.phase === "open" ? " · the numbers are drawn when the board locks" : ""}
        </Label>
      </Card>
      <Card label="Quarter results">
        <Heading>Quarter results</Heading>
        {quarterRows(view).map(({ period, label, result }) => (
          <View
            key={period}
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 8,
            }}
          >
            {/* On a phone the score sits under the quarter's name, so the winner's name has room on one line. */}
            <View
              style={
                stacked
                  ? { width: 112, gap: 2 }
                  : { flexDirection: "row", alignItems: "center", gap: 12, width: 216 }
              }
            >
              <Text
                style={[s.text, { fontFamily: fonts.semibold }, stacked ? { lineHeight: 20 } : { width: 84 }]}
              >
                {label}
              </Text>
              {result && (
                <Text numberOfLines={1} style={[s.muted, !stacked && { flex: 1 }]}>
                  {view.awayTeam} {result.awayScore} · {view.homeTeam} {result.homeScore}
                </Text>
              )}
            </View>
            {result ? (
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                {result.winner ? (
                  <>
                    <Icon name="check-circle" size={18} color={colors.win} />
                    <Text numberOfLines={2} style={[s.text, { flexShrink: 1 }]}>
                      {result.winner.userId === userId ? "You" : result.winner.name}
                      {result.winner.guest ? " (guest)" : ""} won
                    </Text>
                  </>
                ) : (
                  <Text style={[s.muted, { flexShrink: 1 }]}>
                    {result.square ? "No winner: an empty square" : "Not drawn"}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={s.muted}>To come</Text>
            )}
          </View>
        ))}
      </Card>
      <Card label="Players">
        <Heading>Players</Heading>
        {view.players.length === 0 && <Label>Nobody has a square yet.</Label>}
        {view.players.map((player) => (
          <View
            key={player.userId ?? `guest:${player.name}`}
            style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <Avatar avatarId={player.avatarId} name={player.name} size="sm" />
            <Text style={[s.text, { flex: 1 }]}>
              {player.userId === userId ? `${player.name} (you)` : player.name}
            </Text>
            {player.guest && <Pill inline>Guest</Pill>}
            <Text style={[s.text, { fontFamily: fonts.semibold }]}>
              {player.count} {player.count === 1 ? "square" : "squares"}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}

/** A tapped square: who holds it, its numbers, and what it has won. */
export function SquareSheet({
  view,
  row,
  col,
  square,
  close,
  children,
}: {
  view: BoardView;
  row: number;
  col: number;
  square: BoardSquare | undefined;
  close: () => void;
  children?: ReactNode;
}) {
  const wins = winsOf(view.quarters, row, col);
  // A quarter that landed on a square nobody holds is no win: it says so, without the winner's check.
  const emptyHit = !square && wins.length > 0;
  return (
    <Sheet title={square ? `${square.name}'s square` : "Open square"} close={close}>
      {square ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Avatar avatarId={square.avatarId} name={square.name} />
          <Text style={[s.text, { flex: 1 }]}>{square.name}</Text>
          {square.guest && <Pill inline>Guest</Pill>}
        </View>
      ) : (
        <Label>Nobody holds this square.</Label>
      )}
      <View style={{ gap: 4 }}>
        <Eyebrow>Numbers</Eyebrow>
        <Text style={s.text}>
          {view.homeDigits ? squarePlace(view, row, col) : "Drawn when the board locks"}
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        <Eyebrow>{emptyHit ? "No winner" : "Won"}</Eyebrow>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {wins.length > 0 && !emptyHit && <Icon name="check-circle" size={18} color={colors.win} />}
          <Text style={[s.text, { flexShrink: 1 }]}>{winsText(wins, !!square)}</Text>
        </View>
      </View>
      {children}
    </Sheet>
  );
}
