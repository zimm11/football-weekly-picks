// biome-ignore-all lint/correctness/noReactNativeRawText: WeekBadge, CardTitle, Label and Pill render native Text.
import {
  type Game,
  type Side,
  type SurvivorGameView,
  type SurvivorView,
  survivorOutcome,
  teamName,
  WEEK_PHASE_LABEL,
  weekLabel,
  weekPhase,
} from "@picks/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { FadeIn } from "../../components/FadeIn";
import { Icon, type IconName } from "../../components/Icon";
import { hoverFill, pressTile, ringInside } from "../../components/pressState";
import { TeamLogo } from "../../components/TeamLogo";
import { corner, elevation, layout, radius, space, tabular, type, widths } from "../../components/theme";
import { colors, fonts } from "../../components/ui";
import { request } from "../../lib/api";
import { now as clockNow } from "../../lib/clock";
import { haptics } from "../../lib/haptics";
import { offerHomeScreen } from "../../lib/homeScreen";
import { webTransition } from "../../lib/motion";
import {
  asMatchupGame,
  currentWeek,
  draftChanged,
  type PickBanner,
  pickBanner,
  pickHeadline,
  type SurvivorDraft,
  survivorGameLocked,
  survivorMatchup,
  teamChoice,
  teamsUsed,
  waitingLine,
} from "../../lib/survivor";
import { gameDays, kickoffTime } from "../../lib/weekPresentation";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps } from "../leagueTypeScreens";
import {
  Action,
  Card,
  CardTitle,
  Disclosure,
  EmptyState,
  Eyebrow,
  Failure,
  Label,
  RowLink,
  s,
  useEditsGuard,
} from "../leagueUi";
import { MatchupSheet } from "../MatchupSheet";
import { WeekAction, WeekBadge, w } from "../weekUi";
import { LivesPips } from "./LivesPips";
import { SurvivorSkeleton, useSurvivor } from "./useSurvivor";

/**
 * Pick: whether anything is needed this week (the status banner), the pool's status (lives, who's still in,
 * teams used), then the week being played as game cards with a button per team (no spread), and the save bar.
 * A player who is out, or watching this season, sees the week as read-only rows.
 */
export function SurvivorPick({ league, year, userId, header, reload }: LeagueTabProps) {
  const survivor = useSurvivor(league.id, year);
  const [draft, setDraft] = useState<SurvivorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(clockNow);
  const [insight, setInsight] = useState<Game | null>(null);
  const { width } = useWindowDimensions();
  const view = survivor.data;
  const dirty = !!view && draftChanged(view, draft);
  useEditsGuard(dirty, () => {
    setDraft(null);
    setMessage(undefined);
  });
  useFocusEffect(
    useCallback(() => {
      const tick = setInterval(() => {
        if (AppState.currentState === "active") setNow(clockNow());
      }, 1000);
      return () => clearInterval(tick);
    }, []),
  );
  // An unsaved change on a game that has kicked off can't be saved: undo it and say so.
  const draftGame = view && draft ? currentWeek(view)?.games.find((g) => g.id === draft.gameId) : undefined;
  const lockedDraft = !!draft && dirty && (!draftGame || survivorGameLocked(draftGame, now));
  const lastUndone = useRef<string | null>(null);
  useEffect(() => {
    if (!lockedDraft || !draft) return;
    const key = `${draft.gameId}:${draft.side}`;
    if (lastUndone.current === key) return;
    lastUndone.current = key;
    setDraft(null);
    setMessage(
      draftGame
        ? `Your change was undone: ${survivorMatchup(draftGame)} kicked off.`
        : "Your change was undone: that game was removed.",
    );
  }, [lockedDraft, draft, draftGame]);

  // Pulling down reloads the pool this tab shows, and the league around it.
  const refresh = () => Promise.all([survivor.refresh(), reload()]);
  if (!view) {
    return (
      <LeagueTabScroll header={header} reload={refresh}>
        {survivor.error ? <Failure message={survivor.error} retry={survivor.reload} /> : <SurvivorSkeleton />}
      </LeagueTabScroll>
    );
  }
  const week = currentWeek(view);
  const me = view.players.find((p) => p.userId === userId);
  const canPick = !!week && !!me?.alive && !view.watching && !view.over;
  const saved = view.current?.myPick ?? null;
  const shown = draft ?? (saved ? { gameId: saved.gameId, side: saved.side } : null);
  const banner = pickBanner(view, userId, now);
  // Something can still change: a game is open to a pick, and the saved pick hasn't kicked off.
  const savedGame = saved && week?.games.find((g) => g.id === saved.gameId);
  const open =
    !!week &&
    week.games.some((g) => !survivorGameLocked(g, now)) &&
    !(savedGame && survivorGameLocked(savedGame, now));
  const pickedGame = shown && week?.games.find((g) => g.id === shown.gameId);
  const pickedTeam =
    pickedGame && shown ? (shown.side === "home" ? pickedGame.homeTeam : pickedGame.awayTeam) : null;
  // Two cards across from a tablet's width up, in kickoff order row by row.
  const columns = width >= 768 ? 2 : 1;

  function choose(game: SurvivorGameView, side: Side) {
    if (saving) return;
    if (shown?.gameId !== game.id || shown.side !== side) haptics.select();
    setDraft({ gameId: game.id, side });
    setMessage(undefined);
    setError(undefined);
  }
  async function save() {
    if (!draft || !week || saving) return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await request(`/weeks/${week.id}/survivor-pick`, { method: "PUT", body: draft });
      setDraft(null);
      setMessage("Pick saved.");
      haptics.success();
      survivor.reload();
      offerHomeScreen("pick");
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : "Couldn't save your pick. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const days = week ? gameDays(week.games.map(asMatchupGame), view.timeZone) : [];
  const gameOf = (id: string) => week?.games.find((x) => x.id === id) as SurvivorGameView;
  return (
    <View style={{ flex: 1 }}>
      <LeagueTabScroll header={header} reload={refresh}>
        <Failure message={survivor.error} retry={survivor.reload} />
        <View style={st.titleRow}>
          <Text accessibilityRole="header" style={s.title}>
            {week ? weekLabel(week.number) : "Your pick"}
          </Text>
          {week && (
            <WeekBadge tone={week.status === "open" ? "primary" : "outline"}>
              {WEEK_PHASE_LABEL[weekPhase(week.status, week.games, now)]}
            </WeekBadge>
          )}
        </View>
        {banner && <PickStatus banner={banner} />}
        <PoolStatus view={view} userId={userId} canPick={canPick} />
        {week && !canPick && (
          <RowLink href={`/leagues/${league.id}/standings`}>
            <Icon name="trophy" size={20} color={colors.mutedForeground} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.text, { fontFamily: fonts.semibold }]}>See who's left</Text>
              <Text style={s.muted}>
                {`${view.players.filter((p) => p.alive).length} of ${view.players.length} still in`}
              </Text>
            </View>
          </RowLink>
        )}
        {!week && <NoWeek view={view} leagueId={league.id} />}
        {week &&
          days.map((group) => (
            // Keyed by its first game: a day can come round twice when a rescheduled game sits out of order.
            <View key={group.games[0]?.id ?? group.day} style={{ gap: space.md }}>
              <Text accessibilityRole="header" style={st.day}>
                {group.day}
              </Text>
              {!canPick ? (
                <View style={st.rows}>
                  {group.games.map((g, index) => (
                    <GameRow
                      key={g.id}
                      game={gameOf(g.id)}
                      timeZone={view.timeZone}
                      now={now}
                      first={index === 0}
                      onInsight={() => setInsight(g)}
                    />
                  ))}
                </View>
              ) : (
                rowsOf(group.games, columns).map((row) => (
                  <View key={row.map((g) => g.id).join(":")} style={st.cardRow}>
                    {row.map((g) => (
                      <GameCard
                        key={g.id}
                        view={view}
                        game={gameOf(g.id)}
                        draft={shown}
                        saved={saved}
                        canPick={canPick && !saving}
                        now={now}
                        onChoose={choose}
                        onInsight={() => setInsight(g)}
                      />
                    ))}
                    {/* An odd last card keeps its column's width. */}
                    {row.length < columns && <View style={{ flex: 1 }} />}
                  </View>
                ))
              )}
            </View>
          ))}
        <Disclosure title="How survivor works">
          <Label>
            Pick one team a week to win outright, with no spread. A loss, a tie or no pick when the week's
            last game kicks off is a strike, and you're out when your strikes reach the pool's lives (
            {view.settings?.lives ?? 1}). You can't use a team twice in a season; the playoffs start afresh.
            Your pick can change until your team kicks off, and others see it from then. A week that would put
            out everyone still in puts out nobody.
          </Label>
        </Disclosure>
      </LeagueTabScroll>
      {canPick && (open || dirty) && (
        <View style={st.savebar}>
          <View style={st.saveContents}>
            <WeekAction
              label={saving ? "Saving…" : "Save pick"}
              style={{ minWidth: 144 }}
              disabled={!dirty && !saving}
              busy={saving}
              onPress={() => void save()}
            />
            {/* A fixed height, so the bar doesn't grow when "Unsaved changes" appears under the pick. */}
            <View style={st.saveText}>
              <Text numberOfLines={1} style={w.muted}>
                {pickedTeam ? `Your pick: ${teamName(pickedTeam)}` : "No pick yet"}
              </Text>
              {dirty && !message && !error && (
                <View style={{ alignSelf: "flex-start" }}>
                  <WeekBadge tone="primary" small>
                    Unsaved changes
                  </WeekBadge>
                </View>
              )}
              {(message || error) && (
                <Text
                  accessibilityRole={error ? "alert" : undefined}
                  accessibilityLiveRegion="polite"
                  numberOfLines={2}
                  style={[w.small, { color: error ? colors.destructive : colors.win }]}
                >
                  {error ?? message}
                </Text>
              )}
            </View>
          </View>
        </View>
      )}
      <MatchupSheet game={insight} timeZone={view.timeZone} onClose={() => setInsight(null)} />
    </View>
  );
}

/** Splits a day's games into rows of `columns`, in kickoff order. */
function rowsOf<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

const BANNER: Record<PickBanner["kind"], { icon: IconName; fill: string; disc: string; tone: string }> = {
  needs: { icon: "target", fill: colors.primaryTint, disc: colors.primaryTint, tone: colors.primaryText },
  set: { icon: "check", fill: colors.winTint, disc: colors.winTint, tone: colors.win },
  locked: { icon: "lock", fill: colors.card, disc: colors.raised, tone: colors.foreground },
  won: { icon: "check", fill: colors.winTint, disc: colors.winTint, tone: colors.win },
  lost: {
    icon: "close",
    fill: colors.destructiveTint,
    disc: colors.destructiveTint,
    tone: colors.destructive,
  },
  missed: { icon: "minus", fill: colors.card, disc: colors.raised, tone: colors.mutedForeground },
};

/**
 * The first card on the Pick tab: whether anything is needed this week, at a glance. A disc with an icon, a
 * headline and one line, for what is saved (an unsaved choice is the save bar's to say). It fades in when its
 * state changes, so a save that lands reads as the answer.
 */
function PickStatus({ banner }: { banner: PickBanner }) {
  const look = BANNER[banner.kind];
  const done = banner.kind === "set" || banner.kind === "won";
  return (
    <FadeIn key={banner.kind} from={-4}>
      <View role="region" aria-label="Pick status" style={[st.banner, { backgroundColor: look.fill }]}>
        <View style={[st.disc, { backgroundColor: look.disc }]}>
          <Icon name={look.icon} size={22} color={look.tone} weight="bold" />
        </View>
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text style={[type.cardTitle, { color: done ? colors.win : colors.foreground }]}>
            {banner.title}
          </Text>
          <Text style={s.muted}>{banner.detail}</Text>
        </View>
      </View>
    </FadeIn>
  );
}

/**
 * The pool's status for the signed-in player: the headline (still in, out, watching, won) with their lives as
 * pips, how many are still in, and the teams they've used, as chips.
 */
function PoolStatus({ view, userId, canPick }: { view: SurvivorView; userId: string; canPick: boolean }) {
  const me = view.players.find((p) => p.userId === userId);
  const headline = pickHeadline(view, userId);
  const playing = !!me?.alive && !view.over;
  // Between weeks too: the teams already used don't go back to "none" while the pool waits for the next slate.
  const used = playing ? teamsUsed(view, userId) : [];
  const saved = view.current?.myPick;
  return (
    <Card label="Your status">
      <View style={st.statusHead}>
        <View style={{ flex: 1, minWidth: 160, gap: space.xxs }}>
          <CardTitle>{headline.title}</CardTitle>
          {headline.detail && <Label>{headline.detail}</Label>}
          {playing && view.players.length > 0 && (
            <Label>{`${view.players.filter((p) => p.alive).length} of ${view.players.length} still in`}</Label>
          )}
        </View>
        {playing && me && <LivesPips left={me.livesLeft} lives={view.settings?.lives ?? 1} showLabel />}
      </View>
      {used.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Eyebrow>Used</Eyebrow>
          <View style={st.chips}>
            {used.map((u) => (
              <View
                key={u.team}
                accessible
                accessibilityLabel={`${teamName(u.team)}, used in ${weekLabel(u.weekNumber)}`}
                style={st.chip}
              >
                <TeamLogo team={u.team} size={20} />
                <Text style={st.chipText}>{u.team}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {view.current?.usedWaived && canPick && (
        <Label>Every team still to play this week is one you've used, so you may pick any of them.</Label>
      )}
      {saved?.byAdmin && canPick && <Label>A commissioner entered this pick for you.</Label>}
    </Card>
  );
}

/** No week is being played: which week is next and what opens it, or where to see how the pool finished. */
function NoWeek({ view, leagueId }: { view: SurvivorView; leagueId: string }) {
  const waiting = waitingLine(view);
  return (
    <EmptyState
      icon={waiting.standings ? "trophy" : "target"}
      title="No week is being played"
      detail={waiting.detail}
      action={
        waiting.standings ? (
          <Action secondary compact icon="trophy" href={`/leagues/${leagueId}/standings`}>
            Final standings
          </Action>
        ) : undefined
      }
    />
  );
}

/**
 * A game for a player who can't pick (out, or watching): one line, the matchup with small badges and the
 * kickoff time, or the final score. Pressing it opens the matchup sheet.
 */
function GameRow({
  game,
  timeZone,
  now,
  first,
  onInsight,
}: {
  game: SurvivorGameView;
  timeZone: string;
  now: Date;
  first: boolean;
  onInsight: () => void;
}) {
  const final = game.homeScore !== null && game.awayScore !== null;
  const started = survivorGameLocked(game, now);
  const when = final ? "Final" : started ? "Under way" : kickoffTime(game.kickoff, timeZone);
  const score = final ? `, final ${game.awayScore}–${game.homeScore}` : `, ${when}`;
  const side = (team: string, points: number | null, won: boolean) => (
    <View style={st.rowTeam}>
      <TeamLogo team={team} size={20} />
      <Text style={[st.abbr, final && !won && { color: colors.mutedForeground }]}>{team}</Text>
      {final && <Text style={[st.abbr, st.score, !won && { color: colors.mutedForeground }]}>{points}</Text>}
    </View>
  );
  const awayWon = final && (game.awayScore ?? 0) > (game.homeScore ?? 0);
  const homeWon = final && (game.homeScore ?? 0) > (game.awayScore ?? 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Matchup: ${survivorMatchup(game)}${score}`}
      onPress={onInsight}
      style={(state) => [
        webTransition(["background-color"]),
        st.row,
        !first && w.divider,
        { backgroundColor: hoverFill(state) },
        ringInside,
      ]}
    >
      <View style={st.rowMatchup}>
        {side(game.awayTeam, game.awayScore, awayWon)}
        <Text style={w.small}>at</Text>
        {side(game.homeTeam, game.homeScore, homeWon)}
      </View>
      <Text style={[w.small, tabular]}>{when}</Text>
      <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

function GameCard({
  view,
  game,
  draft,
  saved,
  canPick,
  now,
  onChoose,
  onInsight,
}: {
  view: SurvivorView;
  game: SurvivorGameView;
  draft: SurvivorDraft | null;
  saved: NonNullable<SurvivorView["current"]>["myPick"];
  canPick: boolean;
  now: Date;
  onChoose: (game: SurvivorGameView, side: Side) => void;
  onInsight: () => void;
}) {
  const locked = survivorGameLocked(game, now);
  const final = game.homeScore !== null && game.awayScore !== null;
  const mine = saved && saved.gameId === game.id ? survivorOutcome(game, saved.side) : null;
  return (
    <View style={st.gameCard}>
      <View style={st.pickRow}>
        {(["away", "home"] as const).map((side) => {
          const team = side === "home" ? game.homeTeam : game.awayTeam;
          const choice = teamChoice({ view, game, side, draft, canPick, now });
          const isSaved = saved?.gameId === game.id && saved.side === side;
          return (
            <Pressable
              key={side}
              accessibilityRole="button"
              accessibilityLabel={`${teamName(team)}${side === "home" ? ", home" : ""}${choice.note ? `, ${choice.note.toLowerCase()}` : ""}`}
              accessibilityState={{ selected: choice.selected, disabled: choice.disabled }}
              aria-pressed={choice.selected}
              {...({
                "aria-description": choice.selected && !isSaved ? "Not saved yet" : undefined,
              } as object)}
              disabled={choice.disabled}
              onPress={() => onChoose(game, side)}
              style={(state) => [
                webTransition(["background-color", "transform", "opacity", "box-shadow"]),
                st.team,
                choice.selected && st.selected,
                choice.disabled && !choice.selected && st.disabled,
                !choice.disabled && pressTile(state, choice.selected),
              ]}
            >
              {choice.selected && (
                // A check once the pick is saved; a hollow ring while it is only chosen.
                <View style={st.chosen}>
                  <Icon
                    name={isSaved ? "check-circle" : "circle"}
                    size={16}
                    color={colors.primaryForeground}
                  />
                </View>
              )}
              <TeamLogo team={team} size={28} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[st.teamName, choice.selected && { color: colors.primaryForeground }]}
              >
                {teamName(team)}
              </Text>
              <Text style={[st.note, choice.selected && { color: colors.primaryForeground, opacity: 1 }]}>
                {choice.note ?? (side === "home" ? "Home" : "Away")}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={st.cardFoot}>
        <View style={st.meta}>
          {final ? (
            <WeekBadge small>
              Final {game.awayScore}–{game.homeScore}
            </WeekBadge>
          ) : (
            <Text style={[w.small, tabular]}>{kickoffTime(game.kickoff, view.timeZone)}</Text>
          )}
          {locked && !final && (
            <WeekBadge small icon="lock">
              Locked
            </WeekBadge>
          )}
          {mine === "won" && (
            <WeekBadge small tone="win" icon="check">
              Won
            </WeekBadge>
          )}
          {(mine === "lost" || mine === "tie") && (
            <WeekBadge small tone="loss" icon={mine === "tie" ? "equals" : undefined}>
              {mine === "tie" ? "Tie" : "Lost"}
            </WeekBadge>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Matchup: ${survivorMatchup(game)}`}
          onPress={onInsight}
          style={(state) => [
            webTransition(["background-color"]),
            st.insights,
            { backgroundColor: hoverFill(state) },
            ringInside,
          ]}
        >
          <Icon name="chart" size={16} color={colors.mutedForeground} filled />
          <Text style={st.disclosure}>Stats & news</Text>
          <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.md },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    ...corner(radius.xl),
    padding: layout.densePad,
  },
  disc: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  statusHead: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: space.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.raised,
    borderRadius: radius.full,
    paddingLeft: space.xs,
    paddingRight: space.md + space.xxs,
    paddingVertical: space.xs,
  },
  chipText: { ...type.caption, fontFamily: fonts.semibold, color: colors.foreground },
  day: {
    ...type.small,
    fontFamily: fonts.semibold,
    color: colors.mutedForeground,
    marginTop: space.md,
    paddingHorizontal: space.xs,
  },
  cardRow: { flexDirection: "row", gap: space.lg, alignItems: "stretch" },
  gameCard: {
    flex: 1,
    backgroundColor: colors.card,
    ...corner(radius.xl),
    padding: layout.densePad,
    gap: space.md,
    overflow: "hidden",
    boxShadow: elevation.cardEdge,
  },
  pickRow: { flexDirection: "row", alignItems: "stretch", gap: space.md },
  team: {
    flex: 1,
    minHeight: 84,
    ...corner(radius.lg),
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: space.xxs,
  },
  selected: { backgroundColor: colors.primary, boxShadow: elevation.glowPrimary },
  disabled: { opacity: 0.4 },
  chosen: { position: "absolute", top: space.sm, right: space.sm },
  teamName: {
    ...type.subheading,
    color: colors.foreground,
  },
  note: { ...type.caption, fontFamily: fonts.medium, color: colors.foreground, opacity: 0.75 },
  cardFoot: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    marginBottom: -layout.densePad,
    marginRight: -layout.densePad,
  },
  meta: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  insights: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: layout.densePad,
    borderTopLeftRadius: radius.md,
  },
  disclosure: { ...type.small, fontFamily: fonts.medium, color: colors.mutedForeground },
  rows: {
    backgroundColor: colors.card,
    ...corner(radius.xl),
    overflow: "hidden",
    boxShadow: elevation.cardEdge,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: layout.densePad,
    paddingVertical: space.md,
  },
  rowMatchup: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.md },
  rowTeam: { flexDirection: "row", alignItems: "center", gap: space.sm },
  abbr: { ...type.tag, fontSize: 18, lineHeight: 20, color: colors.foreground },
  score: { ...tabular },
  savebar: {
    backgroundColor: colors.chrome,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    boxShadow: elevation.bar,
  },
  saveContents: {
    width: "100%",
    maxWidth: widths.page,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    paddingHorizontal: layout.pageX,
    paddingVertical: space.lg,
  },
  saveText: { flex: 1, gap: space.xs, minHeight: 48, justifyContent: "center" },
});
