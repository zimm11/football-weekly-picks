// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import {
  createGameSchema,
  type Game,
  lowPointLosers,
  MESSAGE_BODY_MAX,
  NFL_TEAMS,
  TEAM_ABBRS,
  THREAD_TITLE_MAX,
  WEEK_PHASE_LABEL,
  type WeekView,
  weekLabel,
  weekPhase,
  zonedParts,
} from "@picks/shared";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  type TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { DateTimeField } from "../components/DateTimeField";
import { NotFound } from "../components/NotFound";
import { Menu, MenuItem, useAnchor } from "../components/Popover";
import { hoverFill } from "../components/pressState";
import { TeamLogo } from "../components/TeamLogo";
import { space, type } from "../components/theme";
import { fonts, Title } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now } from "../lib/clock";
import {
  type GameDraft,
  gameChanges,
  onlyDigits,
  parseLeagueKickoff,
  parseSpread,
  SPREAD_PROBLEM,
} from "../lib/leagueLogic";
import { announceMessagesChanged } from "../lib/messageUnread";
import { useReducedMotion } from "../lib/motion";
import { notifyDone, notifyError } from "../lib/notify";
import { usePageTitle } from "../lib/pageTitle";
import { usePullRefresh } from "../lib/pullRefresh";
import { useScrollRestore } from "../lib/scrollRestore";
import { rememberSeason } from "../lib/seasonSelection";
import { confirmDiscard } from "../lib/unsaved";
import { weekUnit } from "../lib/weekPresentation";
import { LeagueFrame, LeagueTabBar } from "./LeagueChrome";
import { timeZones } from "./LeagueTools";
import {
  Action,
  Card,
  CardTitle,
  colors,
  confirm,
  Disclosure,
  Eyebrow,
  Failure,
  Heading,
  IconButton,
  Input,
  Label,
  Pill,
  Select,
  Skeleton,
  s,
  useEditsGuard,
  useLeagueLoad,
} from "./leagueUi";
import { WeekResults } from "./WeekResults";
import { ScoreCorrection } from "./weekly/ScoreCorrection";

/**
 * A spread field's keyboard. iPhone's number pads have no minus key, so the app asks for numbers and
 * punctuation; a browser has no such keyboard (`inputmode` can't ask for it), so it says plainly "text".
 * Either way nothing is capitalized, corrected or spell-checked.
 */
const spreadKeyboard = {
  ...(Platform.OS === "web"
    ? { inputMode: "text" as const }
    : { keyboardType: "numbers-and-punctuation" as const }),
  autoCorrect: false,
  autoCapitalize: "none" as const,
  spellCheck: false,
  autoComplete: "off" as const,
};
/** A whole-number field (points, scores): the number keyboard, and nothing suggested. */
const digitsKeyboard = { inputMode: "numeric" as const, autoComplete: "off" as const, autoCorrect: false };

export function ManageWeekScreen({ weekId }: { weekId: string }) {
  const { me } = useAuth();
  // Keyed by its API path: the pick sheet remembers the same answer, so either screen opens the other at once.
  const week = useLeagueLoad(() => request<WeekView>(`/weeks/${weekId}`), `/weeks/${weekId}`);
  const pull = usePullRefresh(week.refresh);
  const reduceMotion = useReducedMotion();
  const gone = !week.data && week.status === 404;
  usePageTitle(
    week.data
      ? `Manage ${weekLabel(week.data.number)} · ${week.data.leagueName}`
      : gone
        ? "Week not found"
        : undefined,
  );
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState<{ title: string; body: string }>();
  const [editorVersion, setEditorVersion] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, GameDraft>>({});
  const { width } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollRef = useScrollRestore(scroll);
  const results = useRef<ComponentRef<typeof View>>(null);
  const [resultsY, setResultsY] = useState(0);
  /** Scrolls to the results, measured now: on the web a View's onLayout doesn't hear that it moved down. */
  function showResults() {
    const node = results.current as unknown as { scrollIntoView?: (options: object) => void } | null;
    if (Platform.OS === "web" && node?.scrollIntoView)
      node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    else scroll.current?.scrollTo({ y: resultsY, animated: !reduceMotion });
  }
  const changed = Object.entries(drafts);
  useEffect(() => {
    if (week.data) rememberSeason(week.data.leagueId, week.data.year);
  }, [week.data]);
  const problem = changed.find(([, draft]) => draft.problem)?.[1].problem;
  async function saveAll() {
    if (busy || problem) return;
    setBusy("save");
    try {
      for (const [gameId, draft] of changed) {
        if (draft.changes)
          week.setData(await request<WeekView>(`/games/${gameId}`, { method: "PATCH", body: draft.changes }));
      }
      notifyDone("Changes saved.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Couldn't save game changes.");
    } finally {
      setBusy(undefined);
    }
  }
  function draftChanged(gameId: string, draft: GameDraft | null) {
    setDrafts((prev) => {
      const next = { ...prev };
      if (draft) next[gameId] = draft;
      else delete next[gameId];
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }
  async function act(action: string, path: string, method = "POST", body?: unknown) {
    if (busy) return;
    if (!(await confirmDiscard())) return;
    setBusy(action);
    setError(undefined);
    try {
      const updated = await request<WeekView>(path, { method, body });
      week.setData(updated);
      setEditorVersion((value) => value + 1);
      setDrafts({});
      const done =
        action === "finalize"
          ? "Week finalized. Results are in."
          : action === "open"
            ? "Week opened for picks."
            : action === "import"
              ? "Schedule imported."
              : action === "results"
                ? "Results updated."
                : action === "reopen"
                  ? "Week reopened."
                  : "Week updated.";
      notifyDone(done);
      // A league that runs itself announces opening and finalizing on its own (league events): no thread offer.
      if ((action === "open" || action === "finalize") && updated.management !== "auto") {
        // The confirmation previews the winner and the Low Point Loser.
        const entries = updated.results?.entries ?? [];
        const winners = entries.filter((entry) => entry.isWinner);
        const lpls = lowPointLosers(entries);
        const lplNames = entries.filter((entry) => lpls.includes(entry.userId)).map((e) => e.displayName);
        const resultPreview = winners.length
          ? `Winner${winners.length === 1 ? "" : "s"}: ${winners.map((entry) => `${entry.displayName} (${entry.points} points)`).join(", ")}. `
          : "";
        const lplPreview = lplNames.length
          ? `Low Point Loser${lplNames.length === 1 ? "" : "s"}: ${lplNames.join(", ")}. `
          : "";
        confirm(
          "Post a league message?",
          `${resultPreview}${lplPreview}Create a thread to let your league know. ${updated.status === "final" ? "The final results will be shown with your draft." : "You can edit the message before posting."}`,
          "Write message",
          () =>
            setAnnouncement({
              title: `${updated.year} Week ${updated.number}: ${updated.status === "open" ? "Picks are open" : "Results are final"}`,
              body: done,
            }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the week.");
    } finally {
      setBusy(undefined);
    }
  }
  if (!week.data && !week.error) return <Skeleton label="Loading week management" />;
  if (gone)
    return (
      <NotFound
        title="Week not found"
        detail="It may have been deleted, or you’re no longer in its league."
      />
    );
  if (!week.data)
    return (
      <View style={s.content}>
        <Failure message={week.error} retry={week.reload} />
      </View>
    );
  const view = week.data;
  if (view.role !== "admin")
    return (
      <View style={s.content}>
        <Heading>{weekUnit(view) === "round" ? "Round management" : "Week management"}</Heading>
        <Text style={s.text}>Only league commissioners can manage a {weekUnit(view)}.</Text>
        <Action href={`/weeks/${weekId}`}>Go to the {weekUnit(view)}</Action>
      </View>
    );
  const missing = view.games.filter((game) => game.homeScore === null || game.awayScore === null).length;
  const automatic = view.management === "auto";
  const playoff = view.leagueType === "playoff";
  const unit = weekUnit(view);
  const finalizeAction = (primary: boolean) => (
    <Action
      secondary={!primary}
      busy={busy === "finalize"}
      disabled={(!!busy && busy !== "finalize") || missing > 0 || view.games.length === 0}
      onPress={() =>
        confirm(
          `Finalize the ${unit}?`,
          playoff
            ? "Everyone's picks will be revealed, and the standings updated."
            : "Everyone's picks and the winner will be revealed.",
          `Finalize ${unit}`,
          () => {
            void act("finalize", `/weeks/${weekId}/finalize`);
          },
        )
      }
    >
      {busy === "finalize" ? "Finalizing…" : `Finalize ${unit}`}
    </Action>
  );
  const autoFillResults = (primary: boolean) => (
    <Action
      secondary={!primary}
      busy={busy === "results"}
      disabled={!!busy && busy !== "results"}
      onPress={() =>
        confirm(
          "Auto-fill results?",
          "Automatic results replace any final scores entered by hand. Spreads stay fixed.",
          "Auto-fill results",
          () => {
            void act("results", `/weeks/${weekId}/results`);
          },
        )
      }
    >
      {busy === "results" ? "Filling in…" : "Auto-fill results"}
    </Action>
  );
  // Who has picked: a count first, then the players still missing picks ahead of those who are done.
  const submissions = view.submissions
    ? [...view.submissions].sort(
        (a, b) => Number(a.pickCount >= view.games.length) - Number(b.pickCount >= view.games.length),
      )
    : undefined;
  const allIn = submissions?.filter((entry) => entry.pickCount >= view.games.length).length ?? 0;
  return (
    <View style={s.page}>
      <ScrollView
        ref={scrollRef}
        style={s.page}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        // A focused field stays above the iPhone keyboard, and dragging the page puts the keyboard away.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
      >
        <LeagueFrame leagueId={view.leagueId} leagueName={view.leagueName} active="league" />
        {announcement && (
          <Announcement
            view={view}
            initial={announcement}
            close={() => setAnnouncement(undefined)}
            showResults={showResults}
          />
        )}
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
            <Pill tone={view.status === "open" ? "primary" : "muted"}>
              {WEEK_PHASE_LABEL[weekPhase(view.status, view.games, now())]}
            </Pill>
            <Title>
              {weekLabel(view.number)}{" "}
              <Text style={[type.heading, { color: colors.mutedForeground }]}>· {view.year}</Text>
            </Title>
          </View>
          {view.status !== "draft" && (
            <Action compact secondary href={`/weeks/${weekId}`}>
              {view.status === "open" ? "Make your own picks" : `See the ${unit} as players do`}
            </Action>
          )}
        </View>
        <Card label={playoff ? "Round controls" : "Week controls"}>
          <CardTitle>Manage {unit}</CardTitle>
          {view.status === "draft" && (
            <>
              <Label>
                {!automatic
                  ? "Players can't see this week yet. Check the games and spreads, then open it. Spreads stay fixed once the week is open unless you change them here."
                  : playoff
                    ? "Players can't see this round yet. It opens by itself as soon as every game has a line, and spreads freeze then. Open it now if you'd rather not wait."
                    : view.games.length
                      ? "Players can't see this week yet. It opens by itself on Tuesday at 9 AM Eastern, or as soon as every game has a line after that, and spreads freeze then. Open it now if you'd rather not wait."
                      : "Players can't see this week yet. On Tuesday at 9 AM Eastern its games and that morning's lines fill in automatically and it opens for picks, all at once. Fill it in now only if you'd rather set it up by hand."}
              </Label>
              <Action
                busy={busy === "open"}
                disabled={(!!busy && busy !== "open") || !view.games.length}
                onPress={() => {
                  void act("open", `/weeks/${weekId}/open`);
                }}
              >
                {busy === "open" ? "Opening…" : `Open ${unit} for picks`}
              </Action>
              <Action
                secondary
                busy={busy === "import"}
                disabled={!!busy && busy !== "import"}
                onPress={() => {
                  const run = () => {
                    void act("import", `/weeks/${weekId}/import`);
                  };
                  if (view.games.length)
                    confirm(
                      "Refresh games and spreads?",
                      "Kickoffs and spreads changed by hand will be replaced.",
                      "Refresh",
                      run,
                    );
                  else run();
                }}
              >
                {busy === "import"
                  ? "Filling in…"
                  : view.games.length
                    ? "Refresh games and spreads"
                    : "Auto-fill games and spreads"}
              </Action>
            </>
          )}
          {view.status === "open" && (
            <>
              {missing === 0 && view.games.length > 0 && (
                <Text accessibilityRole="header" aria-level={3} style={[s.subtitle, { color: colors.win }]}>
                  Ready to finalize
                </Text>
              )}
              <Label>
                {missing
                  ? `${missing} of ${view.games.length} games still need a final score.`
                  : automatic
                    ? "All final scores are entered. It finalizes by itself in a few minutes, or finalize it now."
                    : "All final scores are entered. Finalize this week to reveal everyone's picks to the league and update season standings."}{" "}
                {automatic
                  ? "Results fill in automatically as games end, never over a score you typed."
                  : "Auto-filling results updates scores only; spreads stay as they were when the week opened."}
              </Label>
              {/* While scores are missing, filling them in is the job; once they're all in, finalizing is. */}
              {missing > 0 || view.games.length === 0 ? (
                <>
                  {autoFillResults(true)}
                  {finalizeAction(false)}
                </>
              ) : (
                <>
                  {finalizeAction(true)}
                  {autoFillResults(false)}
                </>
              )}
            </>
          )}
          {view.status === "final" && !automatic && (
            <Label>
              Reopen to correct a score or spread. Picks are hidden from players again until you close it.
              Spreads stay as they were when the week opened unless you edit them by hand.
            </Label>
          )}
          {view.status === "final" && automatic && (
            <Label>
              Correct a score below and the results and standings update in place. Nothing needs reopening.
            </Label>
          )}
          {view.status === "final" && !automatic && (
            <Action
              secondary
              busy={busy === "reopen"}
              disabled={!!busy && busy !== "reopen"}
              onPress={() =>
                confirm(
                  "Reopen this week?",
                  "Picks will be hidden from players again until the week is finalized.",
                  "Reopen week",
                  () => {
                    void act("reopen", `/weeks/${weekId}/reopen`);
                  },
                )
              }
            >
              {busy === "reopen" ? "Reopening…" : "Reopen week"}
            </Action>
          )}
          <Failure message={error} />
        </Card>
        {view.status === "open" && submissions && (
          <Card>
            <View style={{ gap: space.xs }}>
              <CardTitle>Who has picked</CardTitle>
              <Label>
                {allIn} of {submissions.length} {submissions.length === 1 ? "has" : "have"} every pick in
              </Label>
            </View>
            <View role="table" aria-label="Who has picked">
              <View
                role="row"
                style={{
                  flexDirection: "row",
                  gap: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  paddingBottom: 8,
                }}
              >
                <Text role="columnheader" style={[s.muted, th, { flex: 1 }]}>
                  Player
                </Text>
                <Text role="columnheader" style={[s.muted, th, { width: 70, textAlign: "right" }]}>
                  Picks in
                </Text>
                <Text role="columnheader" style={[s.muted, th, { width: 68 }]}>
                  POW
                </Text>
              </View>
              {submissions.map((entry) => (
                <View
                  role="row"
                  key={entry.userId}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}
                >
                  <View role="cell" style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Avatar avatarId={entry.avatarId} name={entry.displayName} size={24} />
                    <Text style={[s.text, { flex: 1, fontSize: 14, fontFamily: fonts.medium }]}>
                      {entry.displayName}
                    </Text>
                  </View>
                  <Text
                    role="cell"
                    style={[
                      s.text,
                      {
                        fontSize: 14,
                        width: 70,
                        textAlign: "right",
                        color: entry.pickCount === view.games.length ? colors.win : colors.foreground,
                      },
                    ]}
                  >
                    {entry.pickCount} of {view.games.length}
                  </Text>
                  <View role="cell" style={{ width: 68 }}>
                    {entry.hasPow ? <Pill tone="pow">POW set</Pill> : <Label>—</Label>}
                  </View>
                </View>
              ))}
            </View>
            {/* Everyone's picks on the games that have kicked off, scored as they stand: commissioners only. */}
            <Action secondary href={`/weeks/${weekId}/progress`}>
              See results so far
            </Action>
          </Card>
        )}
        <Failure message={week.error} retry={week.reload} />
        {view.status === "final" && automatic && (
          <ScoreCorrection view={view} onUpdated={week.setData} disabled={!!busy} />
        )}
        {view.status === "final" && view.results ? (
          <View ref={results} onLayout={(event) => setResultsY(event.nativeEvent.layout.y)}>
            <WeekResults view={view} userId={me?.id} />
          </View>
        ) : (
          <>
            <Eyebrow>Games</Eyebrow>
            <Disclosure title="How spreads work">
              <Label>
                Spreads are the home team's line: −3.5 means the home team is favored by 3.5.
                {view.status === "open" && " A game with both scores entered is final and closed to picks."}
              </Label>
            </Disclosure>
            <View role="table" aria-label="Games" style={{ gap: 16 }}>
              {view.games.map((game) => (
                <GameEditor
                  key={`${editorVersion}:${game.id}`}
                  game={game}
                  view={view}
                  disabled={!!busy}
                  saving={busy === "save"}
                  onUpdated={week.setData}
                  onPending={(pending) => setBusy(pending ? `game:${game.id}` : undefined)}
                  onDraftChange={(draft) => draftChanged(game.id, draft)}
                  onSubmit={() => void saveAll()}
                  // Only the Super Bowl has a tiebreaker in a playoff league; the rounds before it have none.
                  tiebreakerChoice={!playoff || !!view.tiebreakerGameId}
                />
              ))}
            </View>
            {view.games.length === 0 && (
              <Label>
                {view.status === "draft"
                  ? "No games yet. Use Auto-fill games and spreads above, or add games below."
                  : "No games yet. Add games below."}
              </Label>
            )}
            <AddGame
              key={`add:${editorVersion}`}
              weekId={weekId}
              timeZone={view.timeZone}
              disabled={!!busy}
              onUpdated={week.setData}
              onPending={(pending) => setBusy(pending ? "add" : undefined)}
            />
          </>
        )}
      </ScrollView>
      {changed.length > 0 && view.status !== "final" && (
        <View style={{ backgroundColor: colors.chrome, borderTopWidth: 1, borderTopColor: colors.border }}>
          {/* Lined up with the page's content column, as the pick sheet's save bar is. */}
          <View
            style={{
              width: "100%",
              maxWidth: 896,
              alignSelf: "center",
              paddingHorizontal: 16,
              paddingVertical: 12,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Action
                busy={busy === "save"}
                disabled={(!!busy && busy !== "save") || !!problem}
                onPress={() => void saveAll()}
              >
                {busy === "save" ? "Saving…" : "Save changes"}
              </Action>
              <Pill tone="primary">
                {changed.length} {changed.length === 1 ? "game" : "games"} changed
              </Pill>
            </View>
            {problem && <Failure message={problem} />}
          </View>
        </View>
      )}
      {width < 768 && <LeagueTabBar leagueId={view.leagueId} active="league" />}
    </View>
  );
}

/** The league time zone's short name for a field label: "Eastern", or the zone's own name. */
const zoneLabel = (timeZone: string) => timeZones.find((zone) => zone.value === timeZone)?.label ?? timeZone;

/** Web's table header: text-xs, font-medium, muted. */
const th = { fontSize: 12, lineHeight: 16, fontFamily: fonts.medium };

type GameField = "spread" | "points" | "homeScore" | "awayScore" | "kickoff";
type Edit = { value: string; base: string };
function localKickoff(value: string, timeZone: string) {
  const p = zonedParts(new Date(value), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function GameEditor({
  game,
  view,
  disabled,
  saving,
  onUpdated,
  onPending,
  onDraftChange,
  onSubmit,
  tiebreakerChoice,
}: {
  game: Game;
  /** The page is saving this row's draft (Save changes): it is on its way, so leaving doesn't ask. */
  saving: boolean;
  onDraftChange: (draft: GameDraft | null) => void;
  /** Enter in one of the row's fields: save the page's changes. */
  onSubmit: () => void;
  /** Whether the week has a tiebreaker game to choose. */
  tiebreakerChoice: boolean;
  view: WeekView;
  disabled: boolean;
  onUpdated: (value: WeekView) => void;
  onPending: (pending: boolean) => void;
}) {
  const [edits, setEdits] = useState<Partial<Record<GameField, Edit>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [scoring, setScoring] = useState(false);
  const options = useAnchor();
  const base = (field: GameField) =>
    field === "kickoff"
      ? localKickoff(game.kickoff, view.timeZone)
      : game[field] === null
        ? ""
        : String(game[field]);
  const shown = (field: GameField) =>
    edits[field]?.base === base(field) ? (edits[field]?.value ?? base(field)) : base(field);
  const setField = (field: GameField, value: string) => {
    setNotice(undefined);
    // Points and scores are whole numbers: letters are dropped as they're typed or pasted.
    const kept = field === "spread" || field === "kickoff" ? value : onlyDigits(value);
    setEdits((previous) => ({ ...previous, [field]: { value: kept, base: base(field) } }));
  };
  const draftUpdate = gameChanges(
    game,
    {
      spread: shown("spread"),
      points: shown("points"),
      kickoff: shown("kickoff"),
      homeScore: shown("homeScore"),
      awayScore: shown("awayScore"),
    },
    view.timeZone,
    view.status,
  );
  const dirty = !!draftUpdate.problem || !!Object.keys(draftUpdate.changes ?? {}).length;
  // Not while this row's draft is being saved, by the row itself or by Save changes, as on other screens.
  useEditsGuard(dirty && !busy && !saving, () => setEdits({}));
  const name = `${game.awayTeam} at ${game.homeTeam}`;
  const showScores =
    view.status === "open" &&
    (scoring ||
      new Date(game.kickoff) <= now() ||
      game.homeScore !== null ||
      !!edits.homeScore ||
      !!edits.awayScore);
  async function update(path: string, method: string, body?: unknown) {
    if (disabled || busy) return;
    setBusy(true);
    onPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const updated = await request<WeekView>(path, { method, body });
      onUpdated(updated);
      setNotice("Game updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the game.");
    } finally {
      setBusy(false);
      onPending(false);
    }
  }
  const draftKey = JSON.stringify(dirty ? draftUpdate : null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialized draft is the stable invalidator; callbacks change on every parent render.
  useEffect(() => {
    onDraftChange(dirty ? draftUpdate : null);
  }, [draftKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: unregister this row's draft when a game is removed or editors are replaced.
  useEffect(() => () => onDraftChange(null), []);
  return (
    <View role="row" style={s.card}>
      <View role="cell" style={{ gap: 16 }}>
        <View style={[s.row, { gap: 8 }]}>
          <TeamLogo team={game.awayTeam} size={24} />
          <Text style={[s.subtitle, { fontSize: 24, textTransform: "none" }]}>{name}</Text>
          <TeamLogo team={game.homeTeam} size={24} />
        </View>
        <Label>
          {new Intl.DateTimeFormat("en-US", {
            timeZone: view.timeZone,
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          }).format(new Date(game.kickoff))}
        </Label>
        <DateTimeField
          label={`Kickoff (${zoneLabel(view.timeZone)} time)`}
          // Not "Kickoff (… time)": that names Add a game's field.
          accessibilityLabel={`Kickoff for ${name}`}
          value={shown("kickoff")}
          onChangeText={(value) => setField("kickoff", value)}
          editable={!disabled && !busy}
          onSubmit={onSubmit}
        />
        <View style={s.row}>
          <View style={s.grow}>
            <Input
              label="Home spread"
              accessibilityLabel={`Home spread for ${name}`}
              value={shown("spread")}
              onChangeText={(value) => setField("spread", value)}
              {...spreadKeyboard}
              editable={!disabled && !busy}
              onSubmit={onSubmit}
            />
          </View>
          <View style={s.grow}>
            <Input
              label="Points"
              accessibilityLabel={`Points for ${name}`}
              value={shown("points")}
              onChangeText={(value) => setField("points", value)}
              {...digitsKeyboard}
              maxLength={2}
              editable={!disabled && !busy}
              onSubmit={onSubmit}
            />
          </View>
        </View>
        {showScores && (
          <View style={s.row}>
            <View style={s.grow}>
              <Input
                label={`${game.awayTeam} score`}
                accessibilityLabel={`${game.awayTeam} score in ${name}`}
                value={shown("awayScore")}
                onChangeText={(value) => setField("awayScore", value)}
                {...digitsKeyboard}
                maxLength={3}
                editable={!disabled && !busy}
                onSubmit={onSubmit}
              />
            </View>
            <View style={s.grow}>
              <Input
                label={`${game.homeTeam} score`}
                accessibilityLabel={`${game.homeTeam} score in ${name}`}
                value={shown("homeScore")}
                onChangeText={(value) => setField("homeScore", value)}
                {...digitsKeyboard}
                maxLength={3}
                editable={!disabled && !busy}
                onSubmit={onSubmit}
              />
            </View>
          </View>
        )}
        {view.status === "open" && !showScores && (
          <Action
            secondary
            muted
            compact
            style={{ alignSelf: "stretch" }}
            icon="plus"
            label={`Enter score for ${name}`}
            disabled={disabled || busy}
            onPress={() => setScoring(true)}
          >
            Enter score
          </Action>
        )}
        <Failure message={error} />
        {notice && (
          <Text accessibilityLiveRegion="polite" style={[s.text, { color: colors.win }]}>
            {notice}
          </Text>
        )}
        <View style={[s.row, { justifyContent: tiebreakerChoice ? "space-between" : "flex-end" }]}>
          {tiebreakerChoice && (
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={`Use ${name} as the tiebreaker game`}
              accessibilityState={{ checked: view.tiebreakerGameId === game.id, disabled: disabled || busy }}
              aria-checked={view.tiebreakerGameId === game.id}
              disabled={disabled || busy}
              onPress={() => void update(`/weeks/${view.id}`, "PATCH", { tiebreakerGameId: game.id })}
              style={(state) => ({
                minHeight: 44,
                flexDirection: "row",
                gap: 10,
                alignItems: "center",
                marginHorizontal: -8,
                paddingHorizontal: 8,
                borderRadius: 10,
                backgroundColor: disabled || busy ? "transparent" : hoverFill(state),
              })}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: view.tiebreakerGameId === game.id ? colors.primary : colors.mutedForeground,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {view.tiebreakerGameId === game.id && (
                  <View
                    style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: colors.primary }}
                  />
                )}
              </View>
              <Text style={[s.text, { fontSize: 14 }]}>Tiebreaker game</Text>
            </Pressable>
          )}
          <IconButton
            name="more"
            label={`Options for ${name}`}
            disabled={disabled || busy}
            ref={options.ref}
            onPress={options.open}
          />
        </View>
        <Menu anchor={options.anchor} onClose={options.close} label={`Options for ${name}`} align="end">
          <MenuItem
            icon="trash"
            destructive
            label="Remove game"
            accessibilityLabel={`Remove ${name}`}
            onPress={() => {
              options.close();
              confirm(
                `Remove ${name}?`,
                view.status === "open"
                  ? "Picks already made on it are deleted."
                  : "You can add it back later.",
                "Remove game",
                () => void update(`/games/${game.id}`, "DELETE"),
                true,
              );
            }}
          />
        </Menu>
      </View>
    </View>
  );
}

function AddGame({
  weekId,
  timeZone,
  disabled,
  onUpdated,
  onPending,
}: {
  weekId: string;
  timeZone: string;
  disabled: boolean;
  onUpdated: (value: WeekView) => void;
  onPending: (pending: boolean) => void;
}) {
  const [homeTeam, setHome] = useState("");
  const [awayTeam, setAway] = useState("");
  const [kickoff, setKickoff] = useState("");
  const [spread, setSpread] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const spreadField = useRef<ComponentRef<typeof TextInput>>(null);
  useEditsGuard(!!(homeTeam || awayTeam || kickoff || spread) && !busy, () => {
    setHome("");
    setAway("");
    setKickoff("");
    setSpread("");
  });
  async function add() {
    if (disabled || busy) return;
    const date = parseLeagueKickoff(kickoff, timeZone);
    if (!date)
      return setError(
        Platform.OS === "web"
          ? "Enter the kickoff's date and time."
          : "Enter a valid kickoff as YYYY-MM-DD HH:mm.",
      );
    if (!spread.trim()) return setError("Enter the home spread.");
    const line = parseSpread(spread);
    // Checked before the schema, whose own words for "abc" are about NaN.
    if (line === null) return setError(SPREAD_PROBLEM);
    const parsed = createGameSchema.safeParse({
      homeTeam,
      awayTeam,
      kickoff: date.toISOString(),
      spread: line,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setBusy(true);
    onPending(true);
    setError(undefined);
    try {
      onUpdated(await request<WeekView>(`/weeks/${weekId}/games`, { method: "POST", body: parsed.data }));
      setHome("");
      setAway("");
      setKickoff("");
      setSpread("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the game.");
    } finally {
      setBusy(false);
      onPending(false);
    }
  }
  const choices = [
    { value: "", label: "Choose a team" },
    ...TEAM_ABBRS.map((team) => ({ value: team, label: `${team} · ${NFL_TEAMS[team]}` })),
  ];
  return (
    <Card label="Add a game">
      <CardTitle>Add a game</CardTitle>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Select
            label="Away team"
            value={awayTeam}
            onChange={setAway}
            choices={choices}
            disabled={disabled || busy}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Select
            label="Home team"
            value={homeTeam}
            onChange={setHome}
            choices={choices}
            disabled={disabled || busy}
          />
        </View>
      </View>
      <DateTimeField
        // "Kickoff (Eastern time)": entered in the league's time zone.
        label={`Kickoff (${zoneLabel(timeZone)} time)`}
        value={kickoff}
        onChangeText={setKickoff}
        editable={!disabled && !busy}
        onSubmit={() => spreadField.current?.focus()}
      />
      <Input
        ref={spreadField}
        label="Home spread"
        value={spread}
        onChangeText={setSpread}
        {...spreadKeyboard}
        editable={!disabled && !busy}
        onSubmit={() => void add()}
      />
      <Failure message={error} />
      <Action
        secondary
        busy={busy}
        disabled={disabled && !busy}
        onPress={() => {
          void add();
        }}
      >
        {busy ? "Adding…" : "Add game"}
      </Action>
    </Card>
  );
}

function Announcement({
  view,
  initial,
  close,
  showResults,
}: {
  view: WeekView;
  initial: { title: string; body: string };
  close: () => void;
  showResults: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEditsGuard(!busy && !!(title || body), close);
  async function post() {
    if (!title.trim() || !body.trim()) return setError("Enter a title and message.");
    setBusy(true);
    setError(undefined);
    try {
      await request(`/leagues/${view.leagueId}/messages`, { method: "POST", body: { title, body } });
      announceMessagesChanged();
      notifyDone("Thread created.");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post the announcement.");
    } finally {
      setBusy(false);
    }
  }
  const entries = view.status === "final" ? (view.results?.entries ?? []) : [];
  const lpls = lowPointLosers(entries);
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return (
    <Card label="League announcement">
      <Heading>Post a league message</Heading>
      {entries.length > 0 && (
        // The results beside the draft, for reference while writing.
        <View
          role="region"
          aria-label="Final results"
          style={{ gap: 8, borderRadius: 12, backgroundColor: colors.field, padding: 12 }}
        >
          <Text accessibilityRole="header" aria-level={4} style={[s.text, { fontFamily: fonts.semibold }]}>
            Final results
          </Text>
          <Label>Reference these results while writing your message.</Label>
          <View role="list" aria-label="Player results" style={{ gap: 8 }}>
            {entries.map((entry) => (
              <View
                role="listitem"
                key={entry.userId}
                style={{ gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}
              >
                <View style={{ flexDirection: "row", gap: 12, justifyContent: "space-between" }}>
                  <Text style={[s.text, { flex: 1, fontFamily: fonts.medium }]}>
                    {entry.rank}. {entry.displayName}
                    {entry.isWinner && (
                      <Text style={{ color: colors.win, fontFamily: fonts.displayBold }}> Winner</Text>
                    )}
                    {lpls.includes(entry.userId) && (
                      <Text style={{ color: colors.mutedForeground, fontFamily: fonts.displayBold }}>
                        {" "}
                        Low Point Loser
                      </Text>
                    )}
                  </Text>
                  <Text style={[s.text, { fontFamily: fonts.semibold }]}>{entry.points} pts</Text>
                </View>
                <Text style={[s.muted, { fontSize: 14 }]}>
                  {count(entry.wins, "win")} · {count(entry.losses, "loss", "losses")} ·{" "}
                  {count(entry.pushes, "push", "pushes")} · Tiebreaker guess: {entry.tiebreakerGuess ?? "—"}
                </Text>
              </View>
            ))}
          </View>
          <Action link ghost compact onPress={showResults} style={{ alignSelf: "flex-start" }}>
            See all picks and game scores ↓
          </Action>
        </View>
      )}
      <Input
        label="Thread title"
        value={title}
        onChangeText={setTitle}
        maxLength={THREAD_TITLE_MAX}
        editable={!busy}
      />
      <Input
        label="Message"
        value={body}
        onChangeText={setBody}
        maxLength={MESSAGE_BODY_MAX}
        multiline
        editable={!busy}
        style={{ minHeight: 128, textAlignVertical: "top", paddingTop: 12 }}
      />
      <Failure message={error} />
      <Action
        busy={busy}
        disabled={!busy && (!title.trim() || !body.trim())}
        onPress={() => {
          void post();
        }}
      >
        {busy ? "Posting…" : "Create thread"}
      </Action>
      <Action
        secondary
        disabled={busy}
        onPress={() =>
          confirm(
            "Discard message?",
            "The week is already updated. This message will not be posted.",
            "Discard",
            close,
            true,
          )
        }
      >
        Skip message
      </Action>
    </Card>
  );
}
