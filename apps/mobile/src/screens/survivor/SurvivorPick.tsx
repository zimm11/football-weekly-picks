// biome-ignore-all lint/correctness/noReactNativeRawText: WeekBadge, Heading, Label and Pill render native Text.
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
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { hoverFill, pressState, ringInside } from "../../components/pressState";
import { TeamLogo } from "../../components/TeamLogo";
import { colors, fonts } from "../../components/ui";
import { request } from "../../lib/api";
import { now as clockNow } from "../../lib/clock";
import { haptics } from "../../lib/haptics";
import { offerHomeScreen } from "../../lib/homeScreen";
import {
  asMatchupGame,
  currentWeek,
  draftChanged,
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
  Disclosure,
  Failure,
  Heading,
  Label,
  StatGrid,
  StatTile,
  s,
  useEditsGuard,
} from "../leagueUi";
import { MatchupSheet } from "../MatchupSheet";
import { WeekAction, WeekBadge, w } from "../weekUi";
import { SurvivorSkeleton, useSurvivor } from "./useSurvivor";

/**
 * Pick: the week being played as game cards with a button per team (no spread), lives left and teams used above
 * them, and the save bar. A player who is out, or watching this season, sees the week read-only.
 */
export function SurvivorPick({ league, year, userId, header, reload }: LeagueTabProps) {
  const survivor = useSurvivor(league.id, year);
  const [draft, setDraft] = useState<SurvivorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(clockNow);
  const [insight, setInsight] = useState<Game | null>(null);
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
  const headline = pickHeadline(view, userId);
  const lives = view.settings?.lives ?? 1;
  // Between weeks too: the teams already used don't go back to "none" while the pool waits for the next slate.
  const used = teamsUsed(view, userId);
  const open = week ? week.games.some((g) => !survivorGameLocked(g, now)) : false;
  const pickedGame = shown && week?.games.find((g) => g.id === shown.gameId);
  const pickedTeam =
    pickedGame && shown ? (shown.side === "home" ? pickedGame.homeTeam : pickedGame.awayTeam) : null;

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

  return (
    <View style={{ flex: 1 }}>
      <LeagueTabScroll header={header} reload={refresh}>
        <Failure message={survivor.error} retry={survivor.reload} />
        <View style={{ gap: 8 }}>
          {week && (
            <WeekBadge tone={week.status === "open" ? "primary" : "outline"}>
              {WEEK_PHASE_LABEL[weekPhase(week.status, week.games, now)]}
            </WeekBadge>
          )}
          <Text accessibilityRole="header" style={s.title}>
            {week ? weekLabel(week.number) : "Your pick"}
          </Text>
        </View>
        <Card label="Your status">
          <Heading>{headline.title}</Heading>
          {headline.detail && <Label>{headline.detail}</Label>}
          {me?.alive && !view.over && (
            <StatGrid>
              <StatTile label="Lives left" value={me.livesLeft} detail={`of ${lives}`} />
              <StatTile
                label="Teams used"
                value={used.length}
                detail={used.length ? "can't be picked again" : "None yet"}
              />
              <StatTile
                label="Still in"
                value={view.players.filter((p) => p.alive).length}
                detail={`of ${view.players.length}`}
              />
            </StatGrid>
          )}
          {/* Abbreviations on one line of their own: a season's worth of full names would swamp the tile. */}
          {me?.alive && !view.over && used.length > 0 && (
            <Label>{`Used: ${used.map((u) => u.team).join(", ")}`}</Label>
          )}
          {view.current?.usedWaived && canPick && (
            <Label>Every team still to play this week is one you've used, so you may pick any of them.</Label>
          )}
          {saved?.byAdmin && <Label>A commissioner entered this pick for you.</Label>}
        </Card>
        {!week && <NoWeek view={view} leagueId={league.id} />}
        {week &&
          gameDays(week.games.map(asMatchupGame), view.timeZone).map((group) => (
            <View key={group.day} style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={st.day}>
                {group.day}
              </Text>
              {group.games.map((g) => {
                const game = week.games.find((x) => x.id === g.id) as SurvivorGameView;
                return (
                  <GameCard
                    key={game.id}
                    view={view}
                    game={game}
                    draft={shown}
                    saved={saved}
                    canPick={canPick && !saving}
                    now={now}
                    onChoose={choose}
                    onInsight={() => setInsight(asMatchupGame(game))}
                  />
                );
              })}
            </View>
          ))}
        <Disclosure title="How survivor works">
          <Label>
            Pick one team a week to win outright, with no spread. A loss, a tie or no pick when the week's
            last game kicks off is a strike, and you're out when your strikes reach the pool's lives ({lives}
            ). You can't use a team twice in a season; the playoffs start afresh. Your pick can change until
            your team kicks off, and others see it from then. A week that would put out everyone still in puts
            out nobody.
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
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={w.muted}>{pickedTeam ? `Your pick: ${teamName(pickedTeam)}` : "No pick yet"}</Text>
              {dirty && !message && !error && <WeekBadge tone="loss">Unsaved changes</WeekBadge>}
              {(message || error) && (
                <Text
                  accessibilityRole={error ? "alert" : undefined}
                  accessibilityLiveRegion="polite"
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

/** No week is being played: which week is next and what opens it, or where to see how the pool finished. */
function NoWeek({ view, leagueId }: { view: SurvivorView; leagueId: string }) {
  const waiting = waitingLine(view);
  return (
    <Card>
      <Heading>No week is being played</Heading>
      <Label>{waiting.detail}</Label>
      {waiting.standings && (
        <Action secondary compact icon="trophy" href={`/leagues/${leagueId}/standings`}>
          Final standings
        </Action>
      )}
    </Card>
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
      <View style={st.gameMeta}>
        <Text style={[w.muted, { marginRight: "auto" }]}>{kickoffTime(game.kickoff, view.timeZone)}</Text>
        {locked && !final && <WeekBadge icon="lock">Locked</WeekBadge>}
        {final && (
          <WeekBadge>
            Final {game.awayScore}–{game.homeScore}
          </WeekBadge>
        )}
        {mine === "won" && (
          <WeekBadge tone="win" icon="check">
            Won
          </WeekBadge>
        )}
        {(mine === "lost" || mine === "tie") && (
          <WeekBadge tone="loss">{mine === "tie" ? "Tie" : "Lost"}</WeekBadge>
        )}
      </View>
      <View style={st.pickRow}>
        {(["away", "home"] as const).map((side) => {
          const team = side === "home" ? game.homeTeam : game.awayTeam;
          const choice = teamChoice({ view, game, side, draft, canPick, now });
          return (
            <Pressable
              key={side}
              accessibilityRole="button"
              accessibilityLabel={`${teamName(team)}${side === "home" ? ", home" : ""}${choice.note ? `, ${choice.note.toLowerCase()}` : ""}`}
              accessibilityState={{ selected: choice.selected, disabled: choice.disabled }}
              aria-pressed={choice.selected}
              disabled={choice.disabled}
              onPress={() => onChoose(game, side)}
              style={(state) => {
                const { pressed, hovered } = pressState(state);
                return [
                  st.team,
                  // A team that can be picked lifts under the mouse.
                  hovered && !choice.selected && { backgroundColor: colors.raisedHover },
                  choice.selected && st.selected,
                  choice.disabled && !choice.selected && st.disabled,
                  pressed && { transform: [{ scale: 0.98 }] },
                ];
              }}
            >
              {choice.selected && (
                <View style={st.chosen}>
                  <Icon name="check-circle" size={16} color={colors.primaryForeground} />
                </View>
              )}
              <TeamLogo team={team} size={36} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[st.teamName, choice.selected && { color: colors.primaryForeground }]}
              >
                {teamName(team)}
              </Text>
              <Text style={[st.note, choice.selected && { color: colors.primaryForeground }]}>
                {choice.note ?? (side === "home" ? "Home" : "Away")}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Matchup: ${survivorMatchup(game)}`}
        onPress={onInsight}
        style={(state) => [st.insights, { backgroundColor: hoverFill(state) }, ringInside]}
      >
        <Icon name="chart" size={16} color={colors.mutedForeground} filled />
        <Text style={[st.disclosure, { flex: 1 }]}>Stats & news</Text>
        <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  day: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.mutedForeground,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  gameCard: { backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 12, overflow: "hidden" },
  gameMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  pickRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  team: {
    flex: 1,
    minHeight: 104,
    borderRadius: 12,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 4,
  },
  selected: { backgroundColor: colors.primary },
  disabled: { opacity: 0.4 },
  chosen: { position: "absolute", top: 6, right: 6 },
  teamName: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 22,
    color: colors.foreground,
  },
  note: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, color: colors.foreground, opacity: 0.75 },
  insights: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    minHeight: 44,
    marginHorizontal: -12,
    marginBottom: -12,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  disclosure: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: colors.mutedForeground },
  savebar: {
    backgroundColor: colors.chrome,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  saveContents: {
    width: "100%",
    maxWidth: 896,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
