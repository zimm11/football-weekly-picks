// biome-ignore-all lint/correctness/noReactNativeRawText: Label, Pill, CardTitle, Eyebrow and Action render native Text.
import { BOARD_PHASE_LABEL, type BoardSquare, type BoardView, teamName } from "@picks/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { Avatar, avatarColor, avatarInitials } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { hoverFill, pressTile } from "../../components/pressState";
import { TeamLogo } from "../../components/TeamLogo";
import { layout, radius, space, tabular, type } from "../../components/theme";
import { Button, colors, fonts } from "../../components/ui";
import { messageOf, request } from "../../lib/api";
import { haptics } from "../../lib/haptics";
import { offerHomeScreen } from "../../lib/homeScreen";
import { webTransition } from "../../lib/motion";
import { notifyError } from "../../lib/notify";
import {
  boardScore,
  cellLabel,
  claimRoom,
  holderKey,
  mySquares,
  type PendingChange,
  quarterRows,
  randomOpenSquare,
  SHORT_PERIOD,
  squareKey,
  squarePlace,
  squareTone,
  winsOf,
  winsText,
  withPending,
} from "../../lib/squaresBoard";
import { kickoffDay, kickoffTime } from "../../lib/weekPresentation";
import { Action, Card, CardTitle, Eyebrow, Failure, Label, Pill, Sheet, s, useLeagueLoad } from "../leagueUi";
import { rememberBoardLeague } from "./boardLeague";
import { BoardSkeleton, RAIL_GAP, RAIL_WIDTH, SquaresGrid, useBoardColumns } from "./SquaresGrid";

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
    // Felt as the cell fills; a refusal is felt through notifyError's banner.
    haptics.select();
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

/**
 * One board as every member sees it: the grid, your squares, the quarter results and who holds squares. On a
 * phone and up to 1023px it is one column (from 768px your squares and the quarter results sit side by side);
 * from 1024px the grid sits on the left, the whole of it in the window, with everything else in a rail beside
 * it. A tap on a name in Players picks out that player's squares on the grid (view state only).
 */
export function BoardPanel({
  boardId,
  board,
  userId,
  displayName,
  avatarId,
}: {
  boardId: string;
  /** The board as `useBoard` loads it. */
  board: ReturnType<typeof useBoard>;
  userId: string;
  displayName: string;
  avatarId?: number | null;
}) {
  const changes = useSquareChanges(boardId, board.setData, board.reload);
  const [sheet, setSheet] = useState<{ row: number; col: number } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const columns = useBoardColumns();
  const { width } = useWindowDimensions();
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
  // A player picked out who no longer holds a square (they gave their last one back) picks out nobody.
  const picked = view.players.some((p) => holderKey(p) === highlight) ? highlight : null;
  const grid = (
    <SquaresGrid
      view={view}
      squares={squares}
      userId={userId}
      onPress={tap}
      highlight={picked}
      fit={columns.fit}
    />
  );
  const random = room.open && (
    <Action
      secondary
      compact={!columns.wide}
      icon="grid"
      disabled={room.left === 0}
      onPress={() => {
        const open = randomOpenSquare(squares);
        if (open) claim(open.row, open.col);
      }}
    >
      Claim a random square
    </Action>
  );
  const help = room.open && (
    <Label>Tap an open square to claim it, and yours to give it back, until the board locks.</Label>
  );
  const nowNote = view.current && (
    <Label>
      {view.live
        ? "Now marks the square that would win if the quarter ended on this score. Scores update every minute."
        : "Now marks the square that would win if the quarter ended on this score."}
    </Label>
  );
  const yours = (
    <YourSquares
      style={columns.wide || width < 768 ? undefined : { flex: 1 }}
      view={view}
      squares={squares}
      mine={mine}
      userId={userId}
      onSquare={(row, col) => setSheet({ row, col })}
    />
  );
  const players = (
    <Players
      view={view}
      userId={userId}
      highlight={picked}
      onHighlight={(key) => setHighlight((was) => (was === key ? null : key))}
    />
  );
  const squareSheet = sheet && (
    <SquareSheet view={view} row={sheet.row} col={sheet.col} square={shown} close={() => setSheet(null)} />
  );
  if (columns.wide) {
    return (
      <View
        onLayout={columns.onLayout}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: RAIL_GAP }}
      >
        <View style={{ flexShrink: 0, width: columns.gridWidth, gap: space.lg }}>
          {grid}
          {help}
          {nowNote}
        </View>
        <View style={{ flex: 1, minWidth: RAIL_WIDTH, gap: space.lg }}>
          <BoardHeading view={view} admin={view.role === "admin"} rail />
          <Failure message={board.error} retry={board.reload} />
          <GameScore view={view} compact />
          {yours}
          {random}
          <QuarterResults view={view} userId={userId} stacked />
          {players}
        </View>
        {squareSheet}
      </View>
    );
  }
  // 768–1023px: one column, with your squares and the quarter results side by side under the grid.
  const pair = width >= 768;
  return (
    <View style={{ gap: layout.pageGap }}>
      <BoardHeading view={view} admin={view.role === "admin"} />
      <Failure message={board.error} retry={board.reload} />
      {/* The score, the grid and its one line of help read as one block, closer together than the cards. */}
      <View style={{ gap: space.lg }}>
        <GameScore view={view} />
        {grid}
        {room.open && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg, alignItems: "center" }}>
            {random}
            <View style={{ flex: 1, minWidth: 200 }}>{help}</View>
          </View>
        )}
        {nowNote}
      </View>
      {pair ? (
        <View style={{ flexDirection: "row", gap: space.xl }}>
          {yours}
          <QuarterResults view={view} userId={userId} stacked style={{ flex: 1 }} />
        </View>
      ) : (
        <>
          {yours}
          <QuarterResults view={view} userId={userId} stacked={width < 560} />
        </>
      )}
      {players}
      {squareSheet}
    </View>
  );
}

/**
 * The game's score as a scoreboard strip above the grid: the away team on the left and the home team on the
 * right, as the title reads, with what the score is between them ("Live", "After Q1", "Final"). Nothing until
 * there is a score. A phone (and the rail beside the grid, `compact`) shows the teams' abbreviations at the
 * strip's ends, since the title spells the names out; a wider screen gathers the names and scores in the middle.
 */
export function GameScore({ view, compact }: { view: BoardView; compact?: boolean }) {
  const { width } = useWindowDimensions();
  const score = boardScore(view);
  if (!score) return null;
  // `compact`: the rail beside the grid, as narrow as a phone.
  const phone = compact || width < 560;
  // The narrowest phones: smaller type, so "WSH 17" still fits beside its badge.
  const size =
    width < 360 ? { logo: 20, name: 16, points: 28, gap: 6 } : { logo: 24, name: 18, points: 32, gap: 8 };
  const wide = { logo: 28, name: 22, points: 38, gap: 12 };
  const { logo, name, points, gap } = phone ? size : wide;
  const side = (team: string, own: number, other: number, home: boolean) => (
    <View
      style={{
        flex: 1,
        flexDirection: home ? "row-reverse" : "row",
        justifyContent: "flex-end",
        alignItems: "center",
        gap,
      }}
    >
      <TeamLogo team={team} size={logo} />
      <Text
        numberOfLines={1}
        style={[
          { fontFamily: fonts.displayBold, fontSize: name, letterSpacing: 0.5, color: colors.foreground },
          phone ? { flex: 1, textAlign: home ? "right" : "left" } : { flexShrink: 1 },
        ]}
      >
        {phone ? team : teamName(team).toUpperCase()}
      </Text>
      {/* Once the game is over, the losing score steps back. */}
      <Text
        style={{
          fontFamily: fonts.displayExtraBold,
          fontSize: points,
          lineHeight: points + 2,
          ...tabular,
          color: score.status === "Final" && own < other ? colors.mutedForeground : colors.foreground,
        }}
      >
        {own}
      </Text>
    </View>
  );
  return (
    <View
      role="region"
      aria-label={`${score.label}: ${teamName(view.awayTeam)} ${score.awayScore}, ${teamName(view.homeTeam)} ${score.homeScore}`}
      style={[
        s.card,
        {
          flexDirection: "row",
          alignItems: "center",
          gap: gap + 2,
          paddingVertical: 10,
          paddingHorizontal: 12,
        },
      ]}
    >
      {side(view.awayTeam, score.awayScore, score.homeScore, false)}
      <View
        style={{ minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}
      >
        {score.live && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.win }} />}
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontSize: 12,
            lineHeight: 16,
            color: score.live ? colors.win : colors.mutedForeground,
          }}
        >
          {score.status}
        </Text>
      </View>
      {side(view.homeTeam, score.homeScore, score.awayScore, true)}
    </View>
  );
}

/**
 * The board's heading: its phase, the game and the kickoff, and for an admin the way to the other board screen.
 * On a phone it is two short rows (phase and kickoff, then the game on one line) so the grid starts higher up.
 * The link swaps the board and its manage screen in place, so going back and forth doesn't pile up history.
 */
export function BoardHeading({
  view,
  admin,
  manage,
  rail,
}: {
  view: BoardView;
  admin: boolean;
  manage?: boolean;
  /** At the top of the rail beside the grid: stacked, with the link as a full-width button under it. */
  rail?: boolean;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 560;
  const title = manage ? "Manage board" : `${teamName(view.awayTeam)} at ${teamName(view.homeTeam)}`;
  const when = `${manage ? `${view.awayTeam} at ${view.homeTeam} · ` : ""}${kickoffDay(view.kickoff, view.timeZone)}, ${kickoffTime(view.kickoff, view.timeZone)}`;
  const pill = (
    <Pill inline={phone} tone={view.phase === "open" ? "primary" : view.phase === "final" ? "win" : "muted"}>
      {BOARD_PHASE_LABEL[view.phase]}
    </Pill>
  );
  const link =
    admin &&
    (manage ? (
      <Action secondary compact href={`/boards/${view.id}`} how="replace">
        View board
      </Action>
    ) : (
      <Action secondary compact href={`/boards/${view.id}/manage`} how="replace">
        Manage board
      </Action>
    ));
  if (rail) {
    return (
      <View style={{ gap: space.sm }}>
        {pill}
        <Text accessibilityRole="header" style={s.title}>
          {title}
        </Text>
        <Label>{when}</Label>
        {admin && (
          <Button
            variant="secondary"
            small
            href={manage ? `/boards/${view.id}` : `/boards/${view.id}/manage`}
            how="replace"
            title={manage ? "View board" : "Manage board"}
            style={{ marginTop: space.sm }}
          />
        )}
      </View>
    );
  }
  if (phone) {
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {pill}
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
        {pill}
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

/**
 * Your squares against your limit and the board's count. Once the numbers are drawn, also a chip per square
 * with its two numbers (home first: "WSH 8 · TB 5"), which is what a player wants during the game: a square
 * that has won says which quarters, with a check; the one that would win now says "Now". A chip opens the
 * square's sheet, as the cell does, and is named as the cell is.
 */
function YourSquares({
  view,
  squares,
  mine,
  userId,
  onSquare,
  style,
}: {
  view: BoardView;
  squares: BoardSquare[];
  mine: number;
  userId: string;
  onSquare: (row: number, col: number) => void;
  style?: ViewStyle;
}) {
  const chips = mySquares(view, userId);
  return (
    <Card label="Your squares" style={style}>
      <CardTitle>Your squares</CardTitle>
      <Text style={[type.stat, { color: colors.foreground }]}>
        {mine} of {view.maxPerPlayer}
      </Text>
      <Label>
        {squares.length} of 100 squares claimed
        {view.phase === "open" ? " · the numbers are drawn when the board locks" : ""}
      </Label>
      {chips.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
          {chips.map((chip) => (
            <NumberChip
              key={squareKey(chip.row, chip.col)}
              chip={chip}
              label={cellLabel({ view, ...chip, userId })}
              onPress={() => onSquare(chip.row, chip.col)}
            />
          ))}
        </View>
      )}
    </Card>
  );
}

function NumberChip({
  chip,
  label,
  onPress,
}: {
  chip: ReturnType<typeof mySquares>[number];
  label: string;
  onPress: () => void;
}) {
  const won = chip.wins.length > 0;
  const small = [type.caption, tabular, { fontFamily: fonts.semibold }] as const;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // 28px tall, so a dozen fit in a few rows; a finger gets the 44px with the slop.
      hitSlop={8}
      style={(state) => [
        {
          minHeight: 28,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: 10,
          borderRadius: radius.full,
          backgroundColor: won ? colors.winTint : colors.raised,
        } as const,
        webTransition(["opacity", "transform"]),
        pressTile(state, true),
      ]}
    >
      {won && <Icon name="check" size={14} color={colors.win} />}
      <Text style={[type.tag, tabular, { color: colors.foreground }]}>{chip.numbers}</Text>
      {won && (
        <Text style={[...small, { color: colors.win }]}>
          {chip.wins.map((p) => SHORT_PERIOD[p]).join(" · ")}
        </Text>
      )}
      {chip.current && <Text style={[...small, { color: colors.win }]}>Now</Text>}
    </Pressable>
  );
}

/**
 * The four quarter results. `stacked` puts each score under its quarter's name, so the winner's name has room
 * on one line: a phone, the rail beside the grid, and half a row from 768px.
 */
function QuarterResults({
  view,
  userId,
  stacked,
  style,
}: {
  view: BoardView;
  userId: string;
  stacked: boolean;
  style?: ViewStyle;
}) {
  return (
    <Card label="Quarter results" style={style}>
      <CardTitle>Quarter results</CardTitle>
      {quarterRows(view).map(({ period, label, result }) => (
        <View
          key={period}
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            gap: space.lg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: space.md,
          }}
        >
          <View
            style={
              stacked
                ? { width: 112, gap: 2 }
                : { flexDirection: "row", alignItems: "center", gap: space.lg, width: 216 }
            }
          >
            <Text
              style={[s.text, { fontFamily: fonts.semibold }, stacked ? { lineHeight: 20 } : { width: 84 }]}
            >
              {label}
            </Text>
            {result && (
              <Text numberOfLines={1} style={[s.muted, tabular, !stacked && { flex: 1 }]}>
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
  );
}

/**
 * Who holds squares, as the grid's legend: each name leads with a chip drawn as that player's cells are (yours
 * solid primary, everyone else's fading from their color), you first. Each row is a toggle that picks out
 * that player's squares on the grid; pressing it again, or another row, changes or clears it.
 */
function Players({
  view,
  userId,
  highlight,
  onHighlight,
}: {
  view: BoardView;
  userId: string;
  highlight: string | null;
  onHighlight: (key: string) => void;
}) {
  const players = [...view.players].sort((a, b) => Number(b.userId === userId) - Number(a.userId === userId));
  return (
    <Card label="Players">
      <CardTitle>Players</CardTitle>
      {players.length === 0 ? (
        <Label>Nobody has a square yet.</Label>
      ) : (
        <Label>Tap a name to find their squares on the board.</Label>
      )}
      {/* The rows reach the card's padding, so a picked row's fill has room around its contents. */}
      <View style={{ marginHorizontal: -space.md }}>
        {players.map((player) => {
          const key = holderKey(player);
          const you = player.userId === userId;
          const on = highlight === key;
          const tone = squareTone({ mine: you, won: false, name: player.name }, avatarColor);
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={you ? "Show your squares" : `Show ${player.name}'s squares`}
              accessibilityState={{ selected: on }}
              aria-pressed={on}
              onPress={() => {
                haptics.select();
                onHighlight(key);
              }}
              style={(state) => [
                {
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  backgroundColor: on ? colors.raised : hoverFill(state),
                } as const,
                webTransition(["background-color"]),
              ]}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: radius.sm,
                  backgroundColor: tone.fill,
                  backgroundImage: tone.gradient,
                  boxShadow: tone.shadow,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {player.avatarId ? (
                  <Avatar name={player.name} avatarId={player.avatarId} size={16} />
                ) : (
                  <Text style={[type.micro, { fontFamily: fonts.semibold, color: tone.ink }]}>
                    {avatarInitials(player.name)}
                  </Text>
                )}
              </View>
              <Text style={[s.text, { flex: 1 }]}>{you ? `${player.name} (you)` : player.name}</Text>
              {player.guest && <Pill inline>Guest</Pill>}
              <Text style={[s.text, tabular, { fontFamily: fonts.semibold }]}>
                {player.count} {player.count === 1 ? "square" : "squares"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
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
