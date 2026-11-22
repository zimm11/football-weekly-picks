// biome-ignore-all lint/correctness/noReactNativeRawText: WeekBadge and WeekCaption render children inside native Text.
import {
  coveringSide,
  type Game,
  lowPointLosers,
  tiebreakerTotal,
  type WeekView,
  weekAwards,
  weekSummary,
} from "@picks/shared";
import { type ReactNode, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { TeamLogo } from "../components/TeamLogo";
import { tabular, type } from "../components/theme";
import { colors, fonts } from "../components/ui";
import { matchup } from "../lib/pickDraft";
import {
  breakdownLine,
  provisionalPowValue,
  resultGuess,
  resultPickCell,
  resultsTileLabels,
  revealedGames,
  type StandingsSoFarRow,
  sharedName,
  standingsSoFar,
  statColumns,
  tileRows,
} from "../lib/resultsPresentation";
import { formatRecord, ordinal, rowsOf } from "../lib/weekPresentation";
import { StatTile } from "./leagueUi";
import { StickyTable } from "./SeasonDashboard";
import { WeekBadge, WeekCaption, w } from "./weekUi";

type Results = NonNullable<WeekView["results"]>;
/**
 * A week's results: the summary tiles, a card per player with every pick, the awards and game by game. Drawn
 * from `view.results` once the week is final; `provisional` draws the results so far on an open week instead
 * (`view.resultsSoFar`, sent to whoever may see them), claiming nothing final: no winner, no Low Point Loser, no
 * awards, and a game the server didn't reveal (not in its `lockedGameIds`) held back, never "no pick". Never the
 * device's clock. So far, once a game has a result, a standings table (place, W–L, points as they stand) comes
 * before the cards (`standingsSoFar`).
 */
export function WeekResults({
  view,
  userId,
  provisional = false,
}: {
  view: WeekView;
  userId?: string;
  provisional?: boolean;
}) {
  const { width } = useWindowDimensions();
  const results = provisional
    ? view.status === "open"
      ? view.resultsSoFar
      : null
    : view.status === "final"
      ? view.results
      : null;
  if (!results) return null;
  // The games whose picks the server sent, as it judged them (results so far only; an older server: none).
  const lockedGameIds = provisional ? (view.resultsSoFar?.lockedGameIds ?? []) : [];
  const me = results.entries.find((entry) => entry.userId === userId);
  const { topPoints, averagePoints } = weekSummary(results.entries);
  const tiebreakerGame = view.games.find((game) => game.id === view.tiebreakerGameId);
  const actual = tiebreakerTotal(tiebreakerGame);
  // So far, the viewer's own POW is theirs to see before its game locks (their own picks).
  const myPowId = provisional
    ? (me?.powGameId ?? view.myPicks.find((pick) => pick.isPow)?.gameId)
    : me?.powGameId;
  const myPow = view.games.find((game) => game.id === myPowId);
  const powPush = myPow && coveringSide({ ...myPow, kickoff: new Date(myPow.kickoff) }) === "push";
  const winners = results.entries.filter((entry) => entry.isWinner);
  const powHits = results.entries.filter((entry) => entry.powWon).length;
  // A playoff round has no winner and no Low Point Loser: one champion, after the Super Bowl.
  const playoff = view.leagueType === "playoff";
  // A playoff round before the Super Bowl has no tiebreaker game, so nothing to guess or show.
  const hasTiebreaker = !playoff || !!view.tiebreakerGameId;
  const tiebreakerLocked = !!view.tiebreakerGameId && lockedGameIds.includes(view.tiebreakerGameId);
  const players = results.entries.length;
  const words = resultsTileLabels({ provisional, playoff });
  // The top score's owner: the week's winner (ties broken), or in a playoff round (and so far) everyone on the
  // top score.
  const topNames =
    playoff || provisional
      ? results.entries.filter((entry) => entry.points === topPoints).map((entry) => entry.displayName)
      : winners.map((entry) => entry.displayName);
  const myGuess = provisional ? (me?.tiebreakerGuess ?? view.myTiebreakerTotal) : me?.tiebreakerGuess;
  const tiles: { label: string; value: ReactNode; detail?: string }[] = [
    ...(me
      ? [
          { label: words.place, value: ordinal(me.rank), detail: `of ${players}` },
          { label: "Your points", value: me.points, detail: formatRecord(me) },
          {
            label: "Your POW",
            value: provisional
              ? provisionalPowValue(myPow, me.powWon)
              : me.powGameId
                ? me.powWon
                  ? "Won"
                  : powPush
                    ? "Push"
                    : "Lost"
                : "None",
            detail: myPow ? matchup(myPow) : undefined,
          },
        ]
      : []),
    {
      label: words.top,
      value: topPoints ?? "—",
      detail: sharedName(topNames),
    },
    {
      label: "League average",
      value: averagePoints === null ? "—" : String(Math.round(averagePoints * 10) / 10),
      detail: `${powHits} of ${players} POWs`,
    },
    ...(hasTiebreaker
      ? [
          {
            label: "Tiebreaker total",
            value: actual ?? "—",
            detail: myGuess != null ? `You: ${myGuess}` : undefined,
          },
        ]
      : []),
  ];
  const shownGames = revealedGames(view.games, { provisional, lockedGameIds });
  // Results so far only, once a game has a result: where everyone stands, from the entries the cards draw.
  const standings = provisional
    ? standingsSoFar(results.entries, view.games, { userId, playoff, number: view.number })
    : null;
  // One row per player, laid out as cards.
  const cards = (
    <View role="table" aria-label={provisional ? "Results so far" : "Week results"} style={{ gap: 12 }}>
      {results.entries.map((entry) => (
        <PlayerResult
          key={entry.userId}
          entry={entry}
          results={results}
          games={view.games}
          actual={actual}
          mine={entry.userId === userId}
          playoff={playoff}
          hasTiebreaker={hasTiebreaker}
          powBonus={view.powBonus}
          provisional={provisional}
          lockedGameIds={lockedGameIds}
          tiebreakerLocked={tiebreakerLocked}
        />
      ))}
    </View>
  );
  return (
    <View style={{ gap: 16 }}>
      <View role="region" aria-label={provisional ? "Summary so far" : "Week summary"} style={{ gap: 8 }}>
        {tileRows(tiles, statColumns(width)).map((row) => (
          <View key={row.items[0]?.label} style={s.statRow}>
            {row.items.map((tile) => (
              <StatTile key={tile.label} compact {...tile} />
            ))}
            {Array.from({ length: row.pad }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: empty slots, all alike.
              <View key={`pad-${i}`} style={{ flex: 1 }} />
            ))}
          </View>
        ))}
      </View>
      {standings ? (
        <>
          <View style={{ gap: 12 }}>
            <WeekCaption>{standings.label}</WeekCaption>
            {/* Fits a 320px phone: 160 for the player, 70 + 54 for the stats, in 288 of content. */}
            <StickyTable
              label={standings.label}
              columns={[
                { title: "W–L", width: 70 },
                { title: "Pts", width: 54 },
              ]}
              rows={standings.rows.map((row) => ({
                id: row.userId,
                mine: row.mine,
                name: <StandingsName row={row} />,
                // Plain values, so the iPhone reads each cell as "Pts: 8".
                values: [row.record, row.points],
              }))}
            />
          </View>
          <View style={{ gap: 12 }}>
            <WeekCaption>Player by player</WeekCaption>
            {cards}
          </View>
        </>
      ) : (
        cards
      )}
      {!provisional && <WeekAwardCards view={view} />}
      {(!provisional || shownGames.length > 0) && (
        <View style={{ gap: 12 }}>
          <WeekCaption>Game by game</WeekCaption>
          {rowsOf(shownGames, width >= 768 ? 2 : 1).map((row) => (
            <View key={row[0]?.id} style={s.statRow}>
              {row.map((game) => (
                <GameBreakdown key={game.id} game={game} results={results} provisional={provisional} />
              ))}
              {row.length === 1 && width >= 768 && <View style={{ flex: 1 }} />}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * The standings so far's player cell, as the season table draws its own: the place right-aligned in a fixed width
 * so the avatars line up, then the avatar and name (bold for the signed-in player, as on the cards).
 */
function StandingsName({ row }: { row: StandingsSoFarRow }) {
  return (
    <View style={[w.row, { gap: 8 }]}>
      <Text style={[s.tableRank, { width: 24, textAlign: "right" }]}>{row.rank}</Text>
      <Avatar avatarId={row.avatarId} name={row.displayName} size={28} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={[s.tableName, row.mine && { fontFamily: fonts.bold }]}>
          {row.displayName}
        </Text>
        {row.removed && <Text style={s.tableRemoved}>No longer in the league</Text>}
      </View>
    </View>
  );
}

function PlayerResult({
  entry,
  results,
  games,
  actual,
  mine,
  playoff = false,
  hasTiebreaker = true,
  powBonus,
  provisional = false,
  lockedGameIds = [],
  tiebreakerLocked = true,
}: {
  entry: Results["entries"][number];
  results: Results;
  games: Game[];
  actual: number | null;
  mine: boolean;
  playoff?: boolean;
  hasTiebreaker?: boolean;
  powBonus?: number;
  /** Results so far: nobody has won or lost the week yet, and games not in `lockedGameIds` are held back. */
  provisional?: boolean;
  /** Results so far: the games the server revealed picks on. */
  lockedGameIds?: string[];
  /** Results so far: the tiebreaker game has locked, so a missing guess means none. */
  tiebreakerLocked?: boolean;
}) {
  const [gridWidth, setGridWidth] = useState(0);
  const lpl = !playoff && !provisional && lowPointLosers(results.entries).includes(entry.userId);
  return (
    <View role="row" style={[s.playerCard, mine && s.mine]}>
      <View role="cell" style={{ gap: 12 }}>
        <View style={s.playerHeading}>
          <View style={[w.row, { gap: 4, width: 44 }]}>
            {entry.isWinner && !provisional && (
              <View accessibilityLabel={playoff ? "Top score" : "Won the week"}>
                <Icon name="trophy" size={16} color={colors.win} filled />
              </View>
            )}
            <Text style={s.rank}>{entry.rank}</Text>
          </View>
          <View style={[w.row, { flex: 1, minWidth: 0 }]}>
            <Avatar avatarId={entry.avatarId} name={entry.displayName} size={28} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={[w.row, { gap: 6, flexWrap: "wrap" }]}>
                <Text style={[s.playerName, mine && { fontFamily: fonts.bold }]}>{entry.displayName}</Text>
                {lpl && (
                  <View accessibilityLabel="Low Point Loser">
                    <WeekBadge>LPL</WeekBadge>
                  </View>
                )}
              </View>
              {entry.removed && <Text style={w.small}>(no longer in the league)</Text>}
            </View>
          </View>
          <Text accessibilityLabel={`${entry.points} points`} style={s.points}>
            {entry.points}
          </Text>
        </View>
        <View style={[w.row, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[w.small, { fontFamily: fonts.medium }]}>W–L</Text>
            <Text style={s.cell}>{formatRecord(entry)}</Text>
          </View>
          {hasTiebreaker ? (
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[w.small, { fontFamily: fonts.medium }]}>
                Tiebreaker{actual === null ? "" : ` (${actual})`}
              </Text>
              <Text style={s.cell}>
                {resultGuess(entry.tiebreakerGuess, { provisional, tiebreakerLocked })}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
        </View>
        <View style={s.picks} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
          {games.map((game) => {
            const pick = results.picks.find(
              (value) => value.userId === entry.userId && value.gameId === game.id,
            );
            const pow = entry.powGameId === game.id;
            const {
              outcome,
              team: abbr,
              label,
            } = resultPickCell(game, pick, {
              pow,
              powBonus,
              provisional,
              revealed: lockedGameIds.includes(game.id),
            });
            return (
              <View
                accessible
                accessibilityLabel={label}
                key={game.id}
                style={[
                  s.pickCell,
                  { width: gridWidth ? (gridWidth - 30) / 6 : 44 },
                  outcome === "won" && s.winningChip,
                ]}
              >
                {abbr ? (
                  <>
                    <View style={outcome === "lost" ? s.lostLogo : undefined}>
                      <TeamLogo team={abbr} size={22} />
                    </View>
                    <Text
                      style={[
                        s.chipText,
                        outcome === "won" && { color: colors.win },
                        outcome === "lost" && {
                          textDecorationLine: "line-through",
                          color: colors.mutedForeground,
                        },
                      ]}
                    >
                      {abbr}
                      {/* So the cell reads "KC POW". */}
                      {pow ? " " : ""}
                    </Text>
                    {outcome === "won" && <Icon name="check" size={12} color={colors.win} weight="bold" />}
                    {outcome === "push" && <Icon name="equals" size={12} color={colors.foreground} />}
                    {pow && (
                      <View style={s.powTag}>
                        <Text style={s.powTagText}>POW</Text>
                      </View>
                    )}
                  </>
                ) : outcome === "hidden" ? (
                  // Held back until kickoff: a lock, never the "—" of a game that locked without a pick.
                  <Icon name="lock" size={16} color={colors.mutedForeground} />
                ) : (
                  <Text style={w.muted}>—</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** `raised` inside a sheet (the recap), where a card in the sheet's own fill would disappear. */
export function WeekAwardCards({
  view,
  showWinner = false,
  raised = false,
}: {
  view: WeekView;
  showWinner?: boolean;
  raised?: boolean;
}) {
  if (view.status !== "final" || !view.results) return null;
  const { results } = view;
  const awards = weekAwards({
    games: view.games.map((game) => ({ ...game, kickoff: new Date(game.kickoff) })),
    ...results,
    tiebreakerGameId: view.tiebreakerGameId,
  });
  const name = (id: string) => results.entries.find((entry) => entry.userId === id)?.displayName ?? "Player";
  const playoff = view.leagueType === "playoff";
  const points = (ids: string[]) =>
    `${results.entries.find((entry) => entry.userId === ids[0])?.points ?? 0} points`;
  const list: {
    key: string;
    title: string;
    names: string[];
    detail: string;
    icon: "trophy" | "smiley-x" | "star" | "target" | "paw";
    tone: string;
  }[] = [];
  if (showWinner && awards.winners.length)
    list.push({
      key: "winner",
      title: awards.winners.length === 1 ? "Winner" : "Winners",
      names: awards.winners.map(name),
      detail: `Top of the week with ${points(awards.winners)}.`,
      icon: "trophy",
      tone: colors.primary,
    });
  if (awards.lowPointLosers.length && !playoff)
    list.push({
      key: "lpl",
      title: awards.lowPointLosers.length === 1 ? "Low Point Loser" : "Low Point Losers",
      names: awards.lowPointLosers.map(name),
      detail: `Bottom of the week with ${points(awards.lowPointLosers)}. Wear it with pride.`,
      icon: "smiley-x",
      tone: colors.mutedForeground,
    });
  if (awards.perfectWeeks.length)
    list.push({
      key: "perfect",
      title: playoff ? "Perfect round" : "Perfect week",
      names: awards.perfectWeeks.map(name),
      detail: "Picked every game and won them all.",
      icon: "star",
      tone: colors.win,
    });
  if (awards.bullseyes.length)
    list.push({
      key: "bullseye",
      title: "Bullseye",
      names: awards.bullseyes.map(name),
      detail: `Called the tiebreaker total exactly: ${tiebreakerTotal(view.games.find((game) => game.id === view.tiebreakerGameId))}.`,
      icon: "target",
      tone: colors.win,
    });
  const wolfGames = new Map<string, string[]>();
  for (const wolf of awards.loneWolves)
    wolfGames.set(wolf.userId, [...(wolfGames.get(wolf.userId) ?? []), wolf.gameId]);
  for (const [id, ids] of wolfGames) {
    const game = view.games.find((game) => game.id === ids[0]);
    const side = results.picks.find((pick) => pick.userId === id && pick.gameId === ids[0])?.side;
    if (!game || !side) continue;
    list.push({
      key: `wolf:${id}`,
      title: "Lone wolf",
      names: [name(id)],
      detail:
        ids.length === 1
          ? `The only one to take ${side === "home" ? game.homeTeam : game.awayTeam} in ${matchup(game)}, and it paid off.`
          : `Alone on the right side of ${ids.length} games.`,
      icon: "paw",
      tone: colors.win,
    });
  }
  if (!list.length) return null;
  return (
    <View role="region" aria-label="Week awards" style={{ gap: 12 }}>
      <WeekCaption>Awards</WeekCaption>
      {list.map((award) => (
        <View key={award.key} style={[s.award, raised && { backgroundColor: colors.raised }]}>
          <View style={[s.awardIcon, raised && { backgroundColor: colors.raisedHover }]}>
            <Icon name={award.icon} size={24} color={award.tone} filled />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[w.small, { fontFamily: fonts.medium }]}>{award.title}</Text>
            <Text style={s.awardNames}>{award.names.join(", ")}</Text>
            <Text style={w.muted}>{award.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function GameBreakdown({
  game,
  results,
  provisional = false,
}: {
  game: Game;
  results: Results;
  /** Results so far: a game without a result says so rather than that nobody got it right. */
  provisional?: boolean;
}) {
  const picks = results.picks.filter((pick) => pick.gameId === game.id);
  const away = picks.filter((pick) => pick.side === "away").length;
  const home = picks.length - away;
  const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
  const right = covered === "home" ? home : covered === "away" ? away : 0;
  const pows = results.entries.filter((entry) => entry.powGameId === game.id).length;
  return (
    <View
      style={[w.card, { flex: 1 }]}
      accessibilityLabel={`${matchup(game)}, ${covered === "push" ? "push" : covered ? `${covered === "home" ? game.homeTeam : game.awayTeam} covered` : "pending"}, ${away} picked away, ${home} picked home`}
    >
      <View style={[w.between, { flexWrap: "wrap" }]}>
        <Text style={s.gameHeading}>
          {matchup(game)}{" "}
          <Text style={w.muted}>
            · {game.awayScore ?? "—"}–{game.homeScore ?? "—"}
          </Text>
        </Text>
        {covered && (
          <WeekBadge tone={covered === "push" ? "outline" : "win"}>
            {covered === "push" ? "Push" : `${covered === "home" ? game.homeTeam : game.awayTeam} covered`}
          </WeekBadge>
        )}
      </View>
      <View style={w.between}>
        <Text style={[s.gameSide, { color: covered === "away" ? colors.win : colors.mutedForeground }]}>
          {game.awayTeam} <Text style={w.muted}>{away}</Text>
        </Text>
        <Text style={[s.gameSide, { color: covered === "home" ? colors.win : colors.mutedForeground }]}>
          {game.homeTeam} <Text style={w.muted}>{home}</Text>
        </Text>
      </View>
      <View style={s.splitBar}>
        {away > 0 && (
          <View
            style={[
              s.segment,
              {
                flex: away,
                backgroundColor: covered === "away" ? colors.win : `${colors.mutedForeground}66`,
              },
            ]}
          />
        )}
        {home > 0 && (
          <View
            style={[
              s.segment,
              {
                flex: home,
                backgroundColor: covered === "home" ? colors.win : `${colors.mutedForeground}66`,
              },
            ]}
          />
        )}
        {!picks.length && <View style={[s.segment, { flex: 1, backgroundColor: colors.muted }]} />}
      </View>
      <View style={[w.row, { gap: 12 }]}>
        <Text style={w.muted}>
          {breakdownLine({ covered, right, players: results.entries.length, provisional })}
        </Text>
        {pows > 0 && (
          <View style={w.row}>
            <WeekBadge tone="pow" small>
              POW
            </WeekBadge>
            <Text style={w.muted}>×{pows}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  statRow: { flexDirection: "row", gap: 8 },
  playerCard: { backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 12 },
  mine: { backgroundColor: colors.raised },
  playerHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  rank: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.mutedForeground, ...tabular },
  tableRank: { ...type.statSmall, ...tabular, fontSize: 18, lineHeight: 20, color: colors.mutedForeground },
  tableName: { ...type.small, lineHeight: 18, fontFamily: fonts.medium, color: colors.foreground },
  tableRemoved: { ...type.micro, fontFamily: fonts.body, color: colors.mutedForeground },
  playerName: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 22, color: colors.foreground },
  cell: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.foreground },
  points: {
    fontFamily: fonts.displayBold,
    fontSize: 30,
    lineHeight: 32,
    color: colors.foreground,
    ...tabular,
  },
  picks: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pickCell: {
    minHeight: 72,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  winningChip: { backgroundColor: `${colors.win}1a`, borderColor: `${colors.win}66` },
  /** Web's `Badge variant="pow"` at h-4 px-1 text-xs, in the chip's condensed face. */
  powTag: {
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: colors.pow,
    justifyContent: "center",
  },
  powTagText: {
    fontFamily: fonts.displaySemibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.powForeground,
  },
  /** Web dims and grays a lost pick's logo (iOS draws grayscale from 16.4; earlier it only dims). */
  lostLogo: { opacity: 0.45, filter: "grayscale(1)" },
  chipText: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 18, color: colors.foreground },
  award: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 12,
  },
  awardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  awardNames: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 26,
    letterSpacing: 0.5,
    color: colors.foreground,
  },
  gameHeading: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 16,
    letterSpacing: 0.5,
    color: colors.foreground,
  },
  gameSide: { fontFamily: fonts.displayBold, fontSize: 18 },
  splitBar: { height: 8, flexDirection: "row", gap: 2, borderRadius: 3, overflow: "hidden" },
  segment: { height: 8 },
});
