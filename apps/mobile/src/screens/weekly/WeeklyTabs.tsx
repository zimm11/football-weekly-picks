// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import {
  coveringSide,
  currentWeek,
  type LeagueDetail,
  type Standings,
  WEEK_PHASE_LABEL,
  type WeekView,
  weekAwards,
  weekLabel,
} from "@picks/shared";
import { type ReactNode, useContext, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { openPath } from "../../components/AppLink";
import { FadeIn } from "../../components/FadeIn";
import { Icon } from "../../components/Icon";
import { type } from "../../components/theme";
import { colors, fonts } from "../../components/ui";
import { request } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { haptics } from "../../lib/haptics";
import {
  type DraftCard,
  draftCards,
  noWeekOpen,
  type RecapMood,
  recapTitle,
  standingLine,
  weeklyRecapHeadline,
} from "../../lib/resultsPresentation";
import { LeagueTabScroll } from "../LeagueTabScroll";
import { LeagueShellContext } from "../leagueContext";
import {
  Action,
  Card,
  CardTitle,
  EmptyState,
  Failure,
  Label,
  RowLink,
  Sheet,
  Skeleton,
  StatTile,
  s,
  useLeagueLoad,
} from "../leagueUi";
import { PlayoffWaiting } from "../playoff/PlayoffWaiting";
import { ordinal, record, SeasonResults, StandingsDashboard } from "../SeasonDashboard";
import { WeekAwardCards } from "../WeekResults";
import { WeekScreen } from "../WeekScreen";

const ignore = () => {};

/*
 * Weekly pick'em's tabs: Picks (the current week's pick sheet), Results and Standings, and the results recap.
 * Playoff pick'em reuses them until it has its own (screens/playoff/).
 */

/** The season's standings, from the same load (and cache key) Results and Standings use. Weekly pick'em only. */
function useSeasonStandings(leagueId: string, year: number | undefined, enabled = true) {
  const on = enabled && year !== undefined;
  return useLeagueLoad<Standings | null>(
    () => (on ? request<Standings>(`/leagues/${leagueId}/standings?year=${year}`) : Promise.resolve(null)),
    on ? `${leagueId}:${year}` : `${leagueId}:${year ?? ""}:no-standings`,
  );
}

export function PicksPanel({
  league,
  year,
  header,
  reload,
  fresh = true,
}: {
  league: LeagueDetail;
  /** The season selected in the header: between weeks, the tab shows where the player stands in it. */
  year?: number;
  header: ReactNode;
  /** Pull to refresh reloads the league too: the cards above the sheet come from it. */
  reload?: () => unknown;
  /** False while `league` is the remembered copy, before this visit's own load has answered. */
  fresh?: boolean;
}) {
  const { me } = useAuth();
  // The week on screen holds through background refreshes (saving picks changes which week still needs them).
  // It is chosen once more when this visit's own load answers: the remembered league can be out of date (a week
  // opened since), and the choice made from it would otherwise stick.
  const [focus, setFocus] = useState(() => ({ id: currentWeek(league.weeks)?.id, settled: fresh }));
  if (fresh && !focus.settled) setFocus({ id: currentWeek(league.weeks)?.id, settled: true });
  const week =
    league.weeks.find((w) => w.id === focus.id && w.status === "open") ?? currentWeek(league.weeks);
  const open = league.weeks.filter((w) => w.status === "open");
  const hasFinal = league.weeks.some((w) => w.status === "final");
  // A league that runs itself opens and finalizes on its own; a playoff league's unit is the round.
  const automatic = league.management === "auto";
  const unit = league.type === "playoff" ? "round" : "week";
  const admin = league.role === "admin";
  // Between weeks, where the player stands: final weeks only, their own numbers (the privacy rule holds).
  const standings = useSeasonStandings(league.id, year, !week && league.type === "weekly" && hasFinal);
  const between = { type: league.type, management: league.management, admin, weeks: league.weeks };
  // The drafts with something for the commissioner to do (lib/resultsPresentation.ts, `draftCards`).
  const cards = draftCards(between);
  /** A draft waiting for the commissioner: the main action between weeks, a quieter one above a pick sheet. */
  const draftCard = (card: DraftCard, main: boolean) => (
    <Card key={card.weekId}>
      <CardTitle>{card.title}</CardTitle>
      <Label>{card.detail}</Label>
      <Action secondary={!main} href={`/weeks/${card.weekId}/manage`}>
        {card.action}
      </Action>
    </Card>
  );
  // A weekly commissioner with a draft to review and nothing open: the draft is the one card, not "No week is
  // open" too.
  const draftsAreTheCard = !week && league.type === "weekly" && cards.length > 0;
  const prelude = (
    <View style={{ gap: 16 }}>
      {header}
      {league.weeks
        .filter((w) => w.phase === "awaiting")
        .map((waiting) => (
          <Card key={waiting.id}>
            {/* Right above that week's own title, the week isn't named twice. */}
            <CardTitle>
              {waiting.id === week?.id
                ? "Awaiting finalization"
                : `${weekLabel(waiting.number)} · Awaiting finalization`}
            </CardTitle>
            <Label>
              {automatic
                ? `All scores are in. The ${unit} finalizes by itself in a few minutes.`
                : admin
                  ? "All final scores are entered. Finalize the week to reveal picks and update standings."
                  : "All scores are in. Your commissioner will finalize the week to publish results."}
            </Label>
            {admin && !automatic && (
              <Action href={`/weeks/${waiting.id}/manage`}>
                Review & finalize {weekLabel(waiting.number)}
              </Action>
            )}
          </Card>
        ))}
      {!draftsAreTheCard && cards.map((card) => draftCard(card, false))}
      {open.length > 1 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {open.map((w) => (
            <Action compact key={w.id} secondary={w.id !== week?.id} href={`/weeks/${w.id}`}>
              {weekLabel(w.number)} · {WEEK_PHASE_LABEL[w.phase]}
            </Action>
          ))}
        </View>
      )}
    </View>
  );
  if (week)
    return <WeekScreen key={week.id} weekId={week.id} embedded header={prelude} refreshAlso={reload} />;
  // A playoff league's own card: the round that opens next, where the guillotine left the player, or that the
  // playoffs are over (screens/playoff/PlayoffWaiting.tsx).
  if (league.type === "playoff") {
    return (
      <LeagueTabScroll header={prelude} reload={reload ?? ignore}>
        <PlayoffWaiting league={league} />
      </LeagueTabScroll>
    );
  }
  const line = standings.data && me ? standingLine(standings.data.entries, me.id) : null;
  const empty = noWeekOpen(between);
  return (
    <LeagueTabScroll
      header={prelude}
      reload={() => Promise.all([standings.data ? standings.refresh() : undefined, reload?.()])}
    >
      <View style={{ gap: 16 }}>
        {draftsAreTheCard ? (
          cards.map((card, index) => draftCard(card, index === 0))
        ) : (
          <EmptyState
            icon="calendar"
            title={empty.title}
            detail={empty.detail}
            action={
              empty.action ? <Action href={`/leagues/${league.id}/league`}>{empty.action}</Action> : undefined
            }
          />
        )}
        {standings.data && standings.data.weeks.length > 0 && me && (
          <FadeIn style={{ gap: 8 }}>
            <SeasonResults
              latestOnly
              standings={standings.data}
              userId={me.id}
              weekHref={(id) => `/weeks/${id}`}
            />
            {line && (
              <RowLink href={`/leagues/${league.id}/standings`} label={`Your season: ${line}`}>
                <Icon name="trophy" size={24} color={colors.mutedForeground} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.muted}>Your season</Text>
                  <Text style={[s.text, { fontFamily: fonts.semibold }]}>{line}</Text>
                </View>
              </RowLink>
            )}
          </FadeIn>
        )}
      </View>
    </LeagueTabScroll>
  );
}
export function SeasonPanel({
  league,
  year,
  userId,
  show,
}: {
  league: LeagueDetail;
  year: number;
  userId: string;
  show: "results" | "standings";
}) {
  const standings = useLeagueLoad(
    () => request<Standings>(`/leagues/${league.id}/standings?year=${year}`),
    `${league.id}:${year}`,
  );
  if (!standings.data && !standings.error)
    return <Skeleton bare label={show === "results" ? "Loading results" : "Loading standings"} />;
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={s.title}>
        {show === "results" ? "Results" : "Standings"}
      </Text>
      <Failure message={standings.error} retry={standings.reload} />
      {standings.data &&
        (show === "results" ? (
          standings.data.weeks.length ? (
            <SeasonResults standings={standings.data} userId={userId} weekHref={(id) => `/weeks/${id}`} />
          ) : (
            <EmptyState
              icon="list"
              title="No results yet"
              detail="No week has closed yet. Everyone's picks and the winner show up here once one does."
            />
          )
        ) : (
          <StandingsDashboard standings={standings.data} userId={userId} />
        ))}
    </View>
  );
}
/**
 * A recap's headline: one line in the card title's face, with a trophy beside a win or a title and the Low Point
 * Loser's face beside that, each in a disc.
 */
export function RecapHeadline({ text, mood }: { text: string; mood: RecapMood }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {mood && (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: mood === "won" ? colors.winTint : colors.raised,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon
            name={mood === "won" ? "trophy" : "smiley-x"}
            size={24}
            color={mood === "won" ? colors.win : colors.mutedForeground}
            filled
          />
        </View>
      )}
      <Text style={[type.cardTitle, { flex: 1, color: colors.foreground }]}>{text}</Text>
    </View>
  );
}

/** The season the league's header has selected, when the recap is drawn inside a league. */
export function useSelectedSeason(): number | undefined {
  return useContext(LeagueShellContext)?.year;
}

/** A recap's ending, the same for every type: see everyone's picks, or close it. The only "Close" in the sheet. */
export function RecapActions({ weekId, close }: { weekId: string; close: () => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Action
        href={`/weeks/${weekId}`}
        onPress={() => {
          close();
          void openPath(`/weeks/${weekId}`);
        }}
      >
        See everyone's picks
      </Action>
      <Action secondary onPress={close}>
        Close
      </Action>
    </View>
  );
}

export function WeekRecap({ weekId, userId, close }: { weekId: string; userId: string; close: () => void }) {
  const week = useLeagueLoad(() => request<WeekView>(`/weeks/${weekId}`), `/weeks/${weekId}`);
  const view = week.data;
  const selectedYear = useSelectedSeason();
  // Only from the server's own answer: a remembered copy may be from before a reopen or a correction.
  const shown = week.fresh && view?.status === "final" && !!view.results;
  const won = !!view?.results?.entries.find((e) => e.userId === userId)?.isWinner;
  useEffect(() => {
    if (shown) void request(`/weeks/${weekId}/recap/seen`, { method: "POST" }).catch(() => {});
  }, [shown, weekId]);
  // Felt once, as the sheet comes up on a week the player won.
  useEffect(() => {
    if (shown && won) haptics.success();
  }, [shown, won]);
  if (!shown || !view?.results) return null;
  const me = view.results.entries.find((e) => e.userId === userId);
  const awards = weekAwards({
    games: view.games.map((g) => ({ ...g, kickoff: new Date(g.kickoff) })),
    entries: view.results.entries,
    picks: view.results.picks,
    tiebreakerGameId: view.tiebreakerGameId,
  });
  const myPow = view.games.find((g) => g.id === me?.powGameId);
  const powPush = myPow && coveringSide({ ...myPow, kickoff: new Date(myPow.kickoff) }) === "push";
  const headline = weeklyRecapHeadline({
    rank: me?.rank,
    playerCount: view.results.entries.length,
    isWinner: me?.isWinner,
    winnerCount: awards.winners.length,
    lowPointLoser: awards.lowPointLosers.includes(userId),
  });
  return (
    <Sheet title={recapTitle(view.number, view.year, selectedYear)} close={close} closeButton={false}>
      <RecapHeadline {...headline} />
      {me && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <StatTile
            raised
            label="Finish"
            value={ordinal(me.rank)}
            detail={`of ${view.results.entries.length}`}
          />
          <StatTile raised label="Points" value={me.points} detail={record(me)} />
          <StatTile
            raised
            label="POW"
            value={me.powGameId ? (me.powWon ? "Won" : powPush ? "Push" : "Lost") : "None"}
            detail={myPow ? `${myPow.awayTeam} at ${myPow.homeTeam}` : undefined}
          />
        </View>
      )}
      <WeekAwardCards view={view} showWinner raised />
      <RecapActions weekId={weekId} close={close} />
    </Sheet>
  );
}
