// biome-ignore-all lint/correctness/noReactNativeRawText: WeekBadge and WeekCaption render children inside native Text.
import {
  coveringSide,
  formatLine,
  type Game,
  lineFor,
  lowPointLosers,
  pickPoints,
  tiebreakerTotal,
  type WeekView,
  weekAwards,
  weekSummary,
} from "@picks/shared";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { TeamLogo } from "../components/TeamLogo";
import { colors, fonts } from "../components/ui";
import { matchup } from "../lib/pickDraft";
import { formatRecord, ordinal } from "../lib/weekPresentation";
import { WeekBadge, WeekCaption, WeekStat, w } from "./weekUi";

type Results = NonNullable<WeekView["results"]>;
export function WeekResults({ view, userId }: { view: WeekView; userId?: string }) {
  if (view.status !== "final" || !view.results) return null;
  const results = view.results;
  const me = results.entries.find((entry) => entry.userId === userId);
  const { topPoints, averagePoints } = weekSummary(results.entries);
  const actual = tiebreakerTotal(view.games.find((game) => game.id === view.tiebreakerGameId));
  const myPow = view.games.find((game) => game.id === me?.powGameId);
  const powPush = myPow && coveringSide({ ...myPow, kickoff: new Date(myPow.kickoff) }) === "push";
  const winners = results.entries.filter((entry) => entry.isWinner);
  const powHits = results.entries.filter((entry) => entry.powWon).length;
  // A playoff round has no winner and no Low Point Loser: one champion, after the Super Bowl.
  const playoff = view.leagueType === "playoff";
  // A playoff round before the Super Bowl has no tiebreaker game, so nothing to guess or show.
  const hasTiebreaker = !playoff || !!view.tiebreakerGameId;
  return (
    <View style={{ gap: 16 }}>
      <View role="region" aria-label="Week summary" style={s.stats}>
        {me && (
          <WeekStat
            label="Your finish"
            value={ordinal(me.rank)}
            detail={me.isWinner ? "You won the week" : `of ${results.entries.length} players`}
            style={s.stat}
          />
        )}
        {me && (
          <WeekStat
            label="Your points"
            value={me.points}
            detail={`${formatRecord(me)} against the spread`}
            style={s.stat}
          />
        )}
        {me && (
          <WeekStat
            label="Your POW"
            value={me.powGameId ? (me.powWon ? "Won" : powPush ? "Push" : "Lost") : "None"}
            detail={myPow ? matchup(myPow) : undefined}
            style={s.stat}
          />
        )}
        <WeekStat
          label={playoff ? "Top score" : "Winning score"}
          value={topPoints ?? "—"}
          detail={winners.length > 1 ? `Shared by ${winners.length}` : undefined}
          style={s.stat}
        />
        <WeekStat
          label="League average"
          value={averagePoints === null ? "—" : String(Math.round(averagePoints * 10) / 10)}
          detail={`${powHits} of ${results.entries.length} POWs hit`}
          style={s.stat}
        />
        {hasTiebreaker && (
          <WeekStat
            label="Tiebreaker total"
            value={actual ?? "—"}
            detail={me?.tiebreakerGuess != null ? `You guessed ${me.tiebreakerGuess}` : undefined}
            style={s.stat}
          />
        )}
      </View>
      {winners.length > 0 && (
        <View style={w.row}>
          <Icon name="trophy" size={24} color={colors.primary} filled />
          <Text style={s.winner}>
            {winners.length === 1 ? "Winner" : "Winners"}:{" "}
            {winners.map((entry) => entry.displayName).join(", ")}
          </Text>
        </View>
      )}
      {/* One row per player, laid out as cards. */}
      <View role="table" aria-label="Week results" style={{ gap: 12 }}>
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
          />
        ))}
      </View>
      <WeekAwardCards view={view} />
      <View style={{ gap: 12 }}>
        <WeekCaption>Game by game</WeekCaption>
        {view.games.map((game) => (
          <GameBreakdown key={game.id} game={game} results={results} />
        ))}
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
}: {
  entry: Results["entries"][number];
  results: Results;
  games: Game[];
  actual: number | null;
  mine: boolean;
  playoff?: boolean;
  hasTiebreaker?: boolean;
  powBonus?: number;
}) {
  const [gridWidth, setGridWidth] = useState(0);
  const lpl = !playoff && lowPointLosers(results.entries).includes(entry.userId);
  return (
    <View role="row" style={[s.playerCard, mine && s.mine]}>
      <View role="cell" style={{ gap: 12 }}>
        <View style={s.playerHeading}>
          <View style={[w.row, { gap: 4, width: 44 }]}>
            {entry.isWinner && <Icon name="trophy" size={16} color={colors.win} filled />}
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
              <Text style={s.cell}>{entry.tiebreakerGuess ?? "—"}</Text>
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
            const scored = { ...game, kickoff: new Date(game.kickoff) };
            const covered = coveringSide(scored);
            const outcome = !pick
              ? "none"
              : covered === null
                ? "pending"
                : covered === pick.side
                  ? "won"
                  : covered === "push"
                    ? "push"
                    : "lost";
            const abbr = pick ? (pick.side === "home" ? game.homeTeam : game.awayTeam) : null;
            const pow = entry.powGameId === game.id;
            const earned = pick ? pickPoints(scored, { side: pick.side, isPow: pow }, powBonus) : null;
            const label = `${matchup(game)}, ${pick && abbr ? formatLine(abbr, lineFor(pick.side, game.spread ?? 0)) : "No pick"}${pow ? ", POW" : ""}, ${outcome === "none" ? "no pick" : outcome}${earned === null ? "" : `, ${earned} points`}. Final ${game.awayScore ?? "pending"} to ${game.homeScore ?? "pending"}.`;
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

function GameBreakdown({ game, results }: { game: Game; results: Results }) {
  const picks = results.picks.filter((pick) => pick.gameId === game.id);
  const away = picks.filter((pick) => pick.side === "away").length;
  const home = picks.length - away;
  const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
  const right = covered === "home" ? home : covered === "away" ? away : 0;
  const pows = results.entries.filter((entry) => entry.powGameId === game.id).length;
  return (
    <View
      style={w.card}
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
          {covered === "push" ? "Nobody scored" : `${right} of ${results.entries.length} got it right`}
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
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexBasis: "48%", flexGrow: 1 },
  winner: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 28,
    color: colors.foreground,
    flex: 1,
  },
  playerCard: { backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 12 },
  mine: { backgroundColor: colors.raised },
  playerHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  rank: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.mutedForeground },
  playerName: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 22, color: colors.foreground },
  cell: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.foreground },
  points: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32, color: colors.foreground },
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
