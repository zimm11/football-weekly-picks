// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import { WEEK_PHASE_LABEL, type WeekView, weekLabel, weekPhase } from "@picks/shared";
import { useEffect } from "react";
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { openPath } from "../components/AppLink";
import { NotFound } from "../components/NotFound";
import { type } from "../components/theme";
import { Title } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now as clockNow } from "../lib/clock";
import { usePageTitle } from "../lib/pageTitle";
import { usePullRefresh } from "../lib/pullRefresh";
import { sharesResultsSoFar } from "../lib/resultsPresentation";
import { useScrollRestore } from "../lib/scrollRestore";
import { rememberSeason } from "../lib/seasonSelection";
import { weekUnit } from "../lib/weekPresentation";
import { LeagueFrame, LeagueTabBar } from "./LeagueChrome";
import {
  Action,
  colors,
  EmptyState,
  Failure,
  Heading,
  Label,
  Pill,
  Skeleton,
  s,
  useLeagueLoad,
} from "./leagueUi";
import { WeekResults } from "./WeekResults";

/**
 * An open week's results so far (`/weeks/:id/progress`): the results page as it stands, from
 * `WeekView.resultsSoFar`, which holds each pick only once its game has locked (`lockedGameIds`, as the server
 * judged it; a remembered copy is drawn first and checked again every minute). The server decides who is sent
 * it: the league's commissioners, and every player in a league that runs itself or a Hands-on one that shares
 * them (`resultsSoFarFor`). Anyone it sends nothing gets a short note and the way to the week; a final week goes
 * to its real results at `/weeks/:id`.
 */
export function WeekProgressScreen({ weekId }: { weekId: string }) {
  const { me } = useAuth();
  // Keyed by its API path, as the pick sheet and Manage week are: any of them opens the others at once. Checked
  // again every minute: picks show as their games kick off, and results fill in as games end.
  const week = useLeagueLoad(() => request<WeekView>(`/weeks/${weekId}`), `/weeks/${weekId}`, 60_000);
  const pull = usePullRefresh(week.refresh);
  const scrollRef = useScrollRestore();
  const { width } = useWindowDimensions();
  const view = week.data;
  const gone = !view && week.status === 404;
  useEffect(() => {
    if (view) rememberSeason(view.leagueId, view.year);
  }, [view]);
  // A final week has its real results: go there instead (only on the server's own answer, not a remembered one).
  const final = week.fresh && view?.status === "final";
  useEffect(() => {
    if (final) void openPath(`/weeks/${weekId}`, "replace");
  }, [final, weekId]);
  usePageTitle(
    view
      ? `${weekLabel(view.number)} results so far · ${view.leagueName}`
      : gone
        ? "Week not found"
        : undefined,
  );
  if (gone)
    return (
      <NotFound
        title="Week not found"
        detail="It may have been deleted, or you’re no longer in its league."
      />
    );
  if ((!view && !week.error) || (view?.status === "final" && !week.error))
    return <Skeleton label="Loading results so far" />;
  if (!view)
    return (
      <View style={s.content}>
        <Failure message={week.error} retry={week.reload} />
      </View>
    );
  const unit = weekUnit(view);
  const results = view.status === "open" ? view.resultsSoFar : null;
  const frame = (
    <LeagueFrame
      leagueId={view.leagueId}
      leagueName={view.leagueName}
      type={view.leagueType}
      active="results"
    />
  );
  const tabBar = width < 768 && (
    <LeagueTabBar leagueId={view.leagueId} type={view.leagueType} active="results" />
  );
  const admin = view.role === "admin";
  // Whether the whole league is sent these, or only its commissioners: the page says which.
  const shared = sharesResultsSoFar(view);
  if (!results) {
    // A commissioner's draft has nothing to show yet; a final week (shown here only when its check failed) has
    // its real results; a player the server sent nothing (the league keeps them to its commissioners) gets the
    // rule.
    const draft = admin && view.status === "draft";
    const closed = view.status === "final";
    return (
      <View style={s.page}>
        <ScrollView
          ref={scrollRef}
          style={s.page}
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
        >
          {frame}
          <Heading level={1}>Results so far</Heading>
          <Text style={s.text}>
            {draft
              ? `This ${unit} hasn't been opened for picks yet.`
              : closed
                ? `${weekLabel(view.number)} is final.`
                : `Only league commissioners see a ${unit}'s results before it is final.`}
          </Text>
          <Action href={draft ? `/weeks/${weekId}/manage` : `/weeks/${weekId}`}>
            {draft ? `Manage ${unit}` : closed ? "See the results" : `Go to the ${unit}`}
          </Action>
        </ScrollView>
        {tabBar}
      </View>
    );
  }
  // The games whose picks the server sent, as it judged them: never this device's clock, which may run ahead, nor
  // a remembered copy's age.
  const lockedCount = results.lockedGameIds?.length ?? 0;
  const finalCount = view.games.filter((game) => game.homeScore !== null && game.awayScore !== null).length;
  return (
    <View style={s.page}>
      <ScrollView
        ref={scrollRef}
        style={s.page}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
      >
        {frame}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Pill tone="primary">{WEEK_PHASE_LABEL[weekPhase(view.status, view.games, clockNow())]}</Pill>
              {!shared && <Pill>Commissioners only</Pill>}
            </View>
            <Title>
              {weekLabel(view.number)}{" "}
              <Text style={[type.heading, { color: colors.mutedForeground }]}>· Results so far</Text>
            </Title>
          </View>
          {admin && (
            <Action compact secondary href={`/weeks/${weekId}/manage`}>
              Manage {unit}
            </Action>
          )}
        </View>
        <Label>
          {shared
            ? `Everyone in the league sees this. A pick shows once its game kicks off, and nothing counts until the ${unit} is final.`
            : `Only commissioners see this until the ${unit} is final. A pick shows once its game kicks off.`}
          {lockedCount > 0
            ? ` ${finalCount} of ${view.games.length} ${view.games.length === 1 ? "game" : "games"} final.`
            : ""}
        </Label>
        <Failure message={week.error} retry={week.reload} />
        {lockedCount === 0 ? (
          <EmptyState
            icon="lock"
            title="No game has kicked off yet"
            detail="Everyone's picks show here as their games kick off."
          />
        ) : (
          <WeekResults view={view} userId={me?.id} provisional />
        )}
      </ScrollView>
      {tabBar}
    </View>
  );
}
