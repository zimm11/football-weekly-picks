// biome-ignore-all lint/correctness/noReactNativeRawText: WeekBadge and WeekCaption render children inside native Text.
import {
  formatLine,
  type Game,
  lineFor,
  type Side,
  scoreSoFar,
  submitPicksSchema,
  teamName,
  WEEK_PHASE_LABEL,
  type WeekView,
  weekLabel,
  weekPhase,
} from "@picks/shared";
import { useFocusEffect } from "expo-router";
import {
  type ComponentRef,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FadeIn } from "../components/FadeIn";
import { Icon } from "../components/Icon";
import { NotFound } from "../components/NotFound";
import { disabledOpacity, hoverFill, pressTile, ringInside } from "../components/pressState";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { TeamLogo } from "../components/TeamLogo";
import { corner, elevation, layout, radius, space, tabular, type, widths } from "../components/theme";
import { Badge, colors, fonts } from "../components/ui";
import { request, statusOf } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now as clockNow } from "../lib/clock";
import { haptics } from "../lib/haptics";
import { offerHomeScreen } from "../lib/homeScreen";
import { onlyDigits } from "../lib/leagueLogic";
import { dropLoadCache, loadCacheGeneration, readLoadCache, writeLoadCache } from "../lib/loadCache";
import { duration, easing, usePop, useReducedMotion, webTransition } from "../lib/motion";
import { usePageTitle } from "../lib/pageTitle";
import {
  draftChanged,
  draftSubmission,
  gameLocked,
  matchup,
  type PickDraft,
  reconcileDraft,
  savedDraft,
} from "../lib/pickDraft";
import { usePullRefresh } from "../lib/pullRefresh";
import { useScrollRestore } from "../lib/scrollRestore";
import { useRemovalGuard, useUnsavedWork } from "../lib/unsaved";
import {
  formatRecord,
  gameDays,
  kickoffTime,
  kickoffZone,
  lockedGameRow,
  PICK_GRID,
  pickSheetLayout,
  pickStatus,
  rowsOf,
  sheetEditable,
  weekHasPow,
  weekUnit,
} from "../lib/weekPresentation";
import { LeagueFrame, LeagueTabBar } from "./LeagueChrome";
import { MatchupSheet } from "./MatchupSheet";
import { PlayoffStatusLine } from "./playoff/PlayoffStatus";
import { WeekResults } from "./WeekResults";
import { WeekAction, WeekBadge, w } from "./weekUi";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
const undoMessage = (undone: string[]) =>
  `Changes to ${undone.join(", ")} were undone because the game locked or was removed.`;
const EMPTY: PickDraft = { sides: {}, pow: null, total: "" };
const web = Platform.OS === "web";
/** How wide the tiebreaker's Stats & news row must be for its time, two pills and "Stats & news" on one line. */
const TIEBREAKER_ROW_WIDTH = 310;

/**
 * A control's extra description for screen readers ("Not saved yet", a game's kickoff and points): on the web
 * `aria-describedby` naming a hidden text (react-native-web passes no `aria-description`), on iPhone the hint.
 */
const describedBy = (id: string | undefined, text: string | undefined) =>
  !id || !text ? {} : web ? ({ "aria-describedby": id } as object) : { accessibilityHint: text };
/** The hidden text a `describedBy` names on the web; nothing on iPhone. */
function Description({ id, children }: { id: string; children: string }) {
  if (!web) return null;
  return (
    <Text nativeID={id} style={s.hidden}>
      {children}
    </Text>
  );
}

export function WeekScreen({
  weekId,
  embedded = false,
  header,
  refreshAlso,
}: {
  weekId: string;
  embedded?: boolean;
  header?: ReactNode;
  /** Also reloaded by the player's pull to refresh: the Picks tab's league, whose cards sit above the sheet. */
  refreshAlso?: () => unknown;
}) {
  const { session } = useAuth();
  // Standalone weeks place the league tabs like every league screen: a row on wide screens, a bottom bar on phones.
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const cacheKey = `/weeks/${weekId}`;
  // The week as it was last shown, drawn at once while it is checked again (`lib/loadCache.ts`). Decided once,
  // as the screen mounts: a mount drawn from it doesn't fade in.
  const [cached] = useState(() => readLoadCache<WeekView>(cacheKey));
  const [view, setView] = useState<WeekView>();
  const [draft, setDraft] = useState<PickDraft>(EMPTY);
  const [error, setError] = useState<string>();
  // The failed load's HTTP status: 404 is a week that is gone or not the player's to see.
  const [errorStatus, setErrorStatus] = useState<number>();
  const [message, setMessage] = useState<string>();
  // "Picks saved." (or "Guess saved."): its own words, with a check, beside any message about the save.
  const [savedNote, setSavedNote] = useState<string>();
  const [saving, setSaving] = useState(false);
  // On iPhone the keyboard is measured from the top of the screen: the app's header (AppHeader: the safe area,
  // 56 points and a 1-point border) sits above this view.
  const headerHeight = useSafeAreaInsets().top + 57;
  const [now, setNow] = useState(clockNow);
  const [insightGame, setInsightGame] = useState<Game | null>(null);
  const [showLocks, setShowLocks] = useState(false);
  // Locked games opened up to their full card, by id. Plain state, so a background refresh keeps them open.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // The games already locked when this week was first shown, while something was still to pick: they fold
  // behind one "N games locked" control. A game that locks while the player is looking stays in view as a row.
  const folded = useRef<{ weekId: string; ids: ReadonlySet<string> } | undefined>(undefined);
  const [showFolded, setShowFolded] = useState(false);
  const viewRef = useRef<WeekView | undefined>(undefined);
  const draftRef = useRef<PickDraft>(EMPTY);
  const serial = useRef(0);
  const savingRef = useRef(false);
  const active = useRef(true);
  const scrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  // The tiebreaker's guess row and field, for the status card's "Add your tiebreaker guess".
  const guessRow = useRef<ComponentRef<typeof View>>(null);
  const guessInput = useRef<ComponentRef<typeof TextInput>>(null);
  const reduced = useReducedMotion();
  const ids = useId();
  const notSavedId = `${ids}-not-saved`;
  const dirty = view?.status === "open" && draftChanged(draft, savedDraft(view));
  const clearNotes = useCallback(() => {
    setMessage(undefined);
    setSavedNote(undefined);
    setError(undefined);
  }, []);
  useUnsavedWork(!!dirty, () => {
    const current = viewRef.current;
    if (!current) return;
    const next = savedDraft(current);
    draftRef.current = next;
    setDraft(next);
    clearNotes();
  });
  useRemovalGuard(!!dirty, saving);

  const updateDraft = useCallback((next: PickDraft) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const accept = useCallback(
    (next: WeekView, reset = false, startedAt = loadCacheGeneration()) => {
      writeLoadCache(`/weeks/${weekId}`, next, startedAt);
      const previous = viewRef.current;
      const wasDirty = previous && draftChanged(draftRef.current, savedDraft(previous));
      if (folded.current?.weekId !== next.id) {
        const at = clockNow();
        const locked = next.games.filter((game) => gameLocked(game, at)).map((game) => game.id);
        const pickable = sheetEditable(next, at).games;
        folded.current = { weekId: next.id, ids: new Set(pickable ? locked : []) };
        if (previous) {
          setShowFolded(false);
          setExpanded(new Set());
        }
      }
      viewRef.current = next;
      setView(next);
      if (reset || !previous || previous.id !== next.id || !wasDirty || next.status !== "open")
        updateDraft(savedDraft(next));
      else {
        const reconciled = reconcileDraft(draftRef.current, next, clockNow());
        updateDraft(reconciled.draft);
        if (reconciled.undone.length) {
          setMessage(undoMessage(reconciled.undone));
          // While saving, the save's own outcome is felt instead.
          if (!savingRef.current) haptics.warn();
        }
      }
    },
    [updateDraft, weekId],
  );
  // The remembered week goes through the same path as a loaded one, before the first paint; the load the focus
  // starts then reconciles the fresh answer with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeded once, on mount.
  useLayoutEffect(() => {
    if (cached && !viewRef.current) accept(cached);
  }, []);
  const load = useCallback(async () => {
    if (savingRef.current) return;
    const id = ++serial.current;
    const startedAt = loadCacheGeneration();
    try {
      const next = await request<WeekView>(`/weeks/${weekId}`);
      if (active.current && serial.current === id) {
        accept(next, false, startedAt);
        setError(undefined);
        setErrorStatus(undefined);
      }
    } catch (err) {
      if (statusOf(err) === 404) dropLoadCache(`/weeks/${weekId}`);
      if (active.current && serial.current === id) {
        setError(errorText(err));
        setErrorStatus(statusOf(err));
      }
    }
  }, [weekId, accept]);
  // The spinner shows for the player's own pull only, never for the minute-by-minute refresh.
  const pull = usePullRefresh(() => Promise.all([load(), refreshAlso?.()]));
  const scrollRef = useScrollRestore(scrollView);
  const gone = !view && errorStatus === 404;
  // Inside the Picks tab the league screen names the page.
  usePageTitle(
    embedded
      ? undefined
      : view
        ? `${weekLabel(view.number)} · ${view.leagueName}`
        : gone
          ? "Week not found"
          : undefined,
  );

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      serial.current += 1;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      const resume = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          setNow(clockNow());
          void load();
        }
      });
      const refresh = setInterval(() => {
        const current = viewRef.current;
        if (
          AppState.currentState === "active" &&
          current?.status === "open" &&
          current.games.some((game) => game.homeScore === null && gameLocked(game, clockNow()))
        )
          void load();
      }, 60_000);
      const tick = setInterval(() => {
        if (AppState.currentState === "active") setNow(clockNow());
      }, 1000);
      return () => {
        resume.remove();
        clearInterval(refresh);
        clearInterval(tick);
      };
    }, [load]),
  );
  useEffect(() => {
    if (view?.status !== "open" || savingRef.current) return;
    const reconciled = reconcileDraft(draftRef.current, view, now);
    if (draftChanged(reconciled.draft, draftRef.current)) updateDraft(reconciled.draft);
    if (reconciled.undone.length) {
      setMessage(undoMessage(reconciled.undone));
      haptics.warn();
    }
  }, [view, now, updateDraft]);

  function edit(next: PickDraft) {
    updateDraft(next);
    clearNotes();
  }
  function choose(game: Game, side: Side) {
    if (viewRef.current?.playoff?.mayPick === false) return;
    if (savingRef.current || gameLocked(game, clockNow())) return;
    if (draftRef.current.sides[game.id] !== side) haptics.select();
    edit({ ...draftRef.current, sides: { ...draftRef.current.sides, [game.id]: side } });
  }
  function togglePow(game: Game) {
    const current = viewRef.current;
    if (!current || current.playoff?.mayPick === false) return;
    if (savingRef.current || gameLocked(game, clockNow()) || !draftRef.current.sides[game.id]) return;
    const savedPowGame = current.games.find((value) => value.id === savedDraft(current).pow);
    if (savedPowGame && gameLocked(savedPowGame, clockNow())) return;
    haptics.toggle();
    edit({ ...draftRef.current, pow: draftRef.current.pow === game.id ? null : game.id });
  }
  /** Brings the tiebreaker's guess row into view and puts the cursor in its field. */
  function goToGuess() {
    const row = guessRow.current;
    const input = guessInput.current;
    if (!row) return;
    if (web) {
      // react-native-web's refs are the elements themselves.
      (row as unknown as HTMLElement).scrollIntoView?.({
        block: "center",
        behavior: reduced ? "auto" : "smooth",
      });
      (input as unknown as HTMLElement | null)?.focus({ preventScroll: true });
      return;
    }
    const inner = scrollView.current?.getInnerViewRef();
    if (inner)
      row.measureLayout(inner, (_x: number, y: number) =>
        scrollView.current?.scrollTo({ y: Math.max(0, y - space["4xl"]), animated: !reduced }),
      );
    input?.focus();
  }
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    serial.current += 1;
    setSaving(true);
    clearNotes();
    try {
      // Refresh the slate before reconciling: an admin may have removed or moved a game.
      const startedAt = loadCacheGeneration();
      const latest = await request<WeekView>(`/weeks/${weekId}`);
      if (!active.current) return;
      if (latest.status !== "open") {
        accept(latest, true, startedAt);
        setMessage(`This ${weekUnit(latest)} is no longer accepting picks.`);
        haptics.warn();
        return;
      }
      const reconciled = reconcileDraft(draftRef.current, latest, clockNow());
      accept(latest, false, startedAt);
      updateDraft(reconciled.draft);
      const parsed = submitPicksSchema.safeParse(draftSubmission(reconciled.draft));
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check your picks.");
        haptics.error();
        return;
      }
      const result = await request<WeekView>(`/weeks/${weekId}/picks`, { method: "PUT", body: parsed.data });
      if (!active.current) return;
      accept(result, true, startedAt);
      // A playoff player the guillotine put out saves only their Super Bowl guess.
      setSavedNote(result.playoff?.mayPick === false ? "Guess saved." : "Picks saved.");
      setMessage(reconciled.undone.length ? undoMessage(reconciled.undone) : undefined);
      // Saved, but a change that locked didn't make it: a warning rather than a success.
      if (reconciled.undone.length) haptics.warn();
      else haptics.success();
      offerHomeScreen();
    } catch (err) {
      if (active.current) {
        setError(errorText(err));
        haptics.error();
      }
    } finally {
      savingRef.current = false;
      if (active.current) setSaving(false);
    }
  }
  if (gone && !embedded)
    return (
      <NotFound
        title="Week not found"
        detail="It may have been deleted, or you’re no longer in its league. An invite link from a commissioner gets you back in."
      />
    );
  if (!view)
    return (
      <View style={s.initial}>
        <View style={s.initialSheet}>
          {header}
          {error ? (
            <View style={w.stack}>
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
              <WeekAction label="Try again" onPress={() => void load()} />
            </View>
          ) : (
            <WeekSkeleton />
          )}
        </View>
        {/* Where the save bar will be. */}
        {!error && (
          <View style={s.skeletonBar}>
            <SkeletonBlock width={144} height={44} radius={radius.md} />
            <SkeletonBlock width={96} height={16} />
          </View>
        )}
      </View>
    );
  const saved = savedDraft(view);
  const powGame = view.games.find((game) => game.id === saved.pow);
  const powFrozen = !!powGame && gameLocked(powGame, now);
  const tiebreaker = view.games.find((game) => game.id === view.tiebreakerGameId);
  const score = scoreSoFar(
    view.games.map((game) => ({ ...game, kickoff: new Date(game.kickoff) })),
    view.myPicks,
    view.powBonus,
  );
  // A league that runs itself finalizes by itself; a playoff player the guillotine put out only watches.
  const automatic = view.management === "auto";
  const closed = view.playoff?.mayPick === false;
  const unit = weekUnit(view);
  const powBonus = view.powBonus ?? 5;
  // A playoff league's Super Bowl has no POW: its one pick is worth the round's points.
  const hasPow = weekHasPow(view);
  const grid = pickSheetLayout(width, hasPow);
  const picked = view.games.filter((game) => draft.sides[game.id]).length;
  const phase = weekPhase(view.status, view.games, now);
  const tab = view.status === "final" ? "results" : "picks";
  const needsPow = pickStatus(view, now).needsPow;
  // Once every game has locked (or has a result) there is nothing left to change, so nothing to save.
  const editable = sheetEditable(view, now);
  const canChange = (!closed && editable.games) || editable.guess;
  const showSaveBar =
    view.status === "open" && (!closed || !!tiebreaker) && (canChange || dirty || !!message || !!error);
  // Games already locked when the sheet was first shown, while something was still to pick, fold behind one
  // control (one line, whatever their number), so the games to pick start on the first screen. Kickoff order
  // stays: shown, the rows sit where their games are. The fold stays for this visit even once the rest lock, so
  // nothing above the player's thumb opens up by itself.
  const isFolded = (game: Game) => !!folded.current?.ids.has(game.id) && gameLocked(game, now);
  const foldable = view.games.filter(isFolded);
  const folding = foldable.length > 0 && !showFolded;
  const hidden = new Set(folding ? foldable.map((game) => game.id) : []);
  const foldLabel = `${foldable.length} ${foldable.length === 1 ? "game" : "games"} locked`;
  const settled = score.wins + score.losses + score.pushes > 0;
  // Once any game has a result, the status card carries the player's own tally (or it stands alone for a
  // player the guillotine put out).
  const tally = view.games.some((game) => game.homeScore !== null && game.awayScore !== null) ? (
    <Tally unit={unit} score={score} hasPow={hasPow} />
  ) : null;
  const toggleRow = (id: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const renderGame = (game: Game) => {
    // Kicked off (or has a result): nothing on it can change, so it is a compact row that opens to the card. A
    // player the guillotine put out can't pick the rest either, but those games aren't locked: they stay cards,
    // and the status line above says why.
    const kickedOff = gameLocked(game, now);
    const isTiebreaker = game.id === view.tiebreakerGameId;
    const controls = (
      <PickControls
        game={game}
        draft={draft}
        saved={saved}
        locked={closed || kickedOff}
        saving={saving}
        hasPow={hasPow}
        powFrozen={powFrozen}
        teamLayout={grid.team}
        smallName={grid.smallName}
        // The tiebreaker's row carries one more pill: on the narrowest cards its words make way for it.
        insightWords={!isTiebreaker || grid.cardInner >= TIEBREAKER_ROW_WIDTH}
        timeZone={view.timeZone}
        tiebreaker={isTiebreaker}
        notSavedId={notSavedId}
        flushBottom={kickedOff || !isTiebreaker}
        onChoose={choose}
        onPow={togglePow}
        onInsight={setInsightGame}
      />
    );
    if (kickedOff)
      return (
        <LockedGame
          game={game}
          row={lockedGameRow(game, saved, { hasPow, powBonus: view.powBonus })}
          timeZone={view.timeZone}
          guess={isTiebreaker && saved.total !== "" ? saved.total : undefined}
          expanded={expanded.has(game.id)}
          onToggle={() => toggleRow(game.id)}
        >
          {controls}
        </LockedGame>
      );
    return (
      <View style={s.gameCard}>
        {controls}
        {isTiebreaker && (
          <GuessRow
            rowRef={guessRow}
            inputRef={guessInput}
            game={game}
            value={draft.total}
            disabled={saving}
            onChange={(total) => edit({ ...draftRef.current, total: onlyDigits(total) })}
            onSubmit={() => {
              if (dirty) void save();
            }}
          />
        )}
      </View>
    );
  };
  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
        contentContainerStyle={[s.content, { paddingBottom: 24 }]}
      >
        {header}
        {/* A cold load fades in over its placeholder; a week drawn from memory is simply there. */}
        <FadeIn enabled={!cached} style={s.sheet}>
          {!embedded && <LeagueFrame leagueId={view.leagueId} leagueName={view.leagueName} active={tab} />}
          <View style={s.titleRow}>
            <Text
              accessibilityRole="header"
              accessibilityLabel={`${weekLabel(view.number)} · ${view.year}`}
              style={s.title}
            >
              {weekLabel(view.number)}
            </Text>
            {/* Part of the heading's name already. */}
            {!embedded && (
              <Text aria-hidden style={s.year}>
                {view.year}
              </Text>
            )}
            {/* The phase and Manage keep together: when the row wraps they share the second line. */}
            <View style={s.titleEnd}>
              <Badge inline tone={view.status === "open" ? "primary" : "muted"}>
                {WEEK_PHASE_LABEL[phase]}
              </Badge>
              {view.role === "admin" && (
                <WeekAction
                  label={`Manage ${unit}`}
                  href={`/weeks/${weekId}/manage`}
                  secondary
                  compact
                  style={s.manage}
                />
              )}
            </View>
          </View>
          {/* In the Picks tab the league's own card above says this, with the commissioner's Review & finalize. */}
          {phase === "awaiting" && !embedded && (
            <View style={w.card}>
              <Text style={s.cardTitle}>Awaiting finalization</Text>
              <Text style={w.muted}>
                {automatic
                  ? "All final scores are in. It finalizes by itself in a few minutes, and everyone's picks are revealed then."
                  : "All final scores are entered. Everyone's picks are revealed, and this week counts in standings, once the commissioner finalizes it."}
              </Text>
            </View>
          )}
          {phase === "underway" &&
            !view.games.some((game) => game.homeScore === null && new Date(game.kickoff) > now) && (
              <Text style={w.muted}>
                {automatic
                  ? `All games have locked. Results fill in as games end, and the ${unit} finalizes by itself after the last one.`
                  : "All games have locked. Results fill in as games end; the week counts once a commissioner finalizes it."}
              </Text>
            )}
          {view.status === "draft" && (
            <View style={w.card}>
              <Text style={w.body}>This {unit} hasn't been opened for picks yet.</Text>
            </View>
          )}
          {view.status === "final" && <WeekResults view={view} userId={session?.user.id} />}
          {view.status === "open" && (
            <>
              <PlayoffStatusLine view={view} />
              {!closed ? (
                <PickStatusBanner
                  view={view}
                  now={now}
                  canChange={editable.games}
                  tally={tally}
                  onGuess={goToGuess}
                />
              ) : (
                tally && <View style={w.card}>{tally}</View>
              )}
              <Description id={notSavedId}>Not saved yet</Description>
              {foldable.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={foldLabel}
                  accessibilityState={{ expanded: showFolded }}
                  aria-expanded={showFolded}
                  onPress={() => setShowFolded(!showFolded)}
                  style={(state) => [
                    s.fold,
                    { backgroundColor: hoverFill(state, colors.card) },
                    webTransition(["background-color"]),
                  ]}
                >
                  <Icon name="lock" size={16} color={colors.mutedForeground} />
                  <Text numberOfLines={1} style={[s.disclosure, tabular, { flex: 1 }]}>
                    {foldLabel}
                    {settled ? ` · ${formatRecord(score)} so far` : ""}
                  </Text>
                  <Text style={s.disclosure}>{showFolded ? "Hide" : "Show"}</Text>
                  <Chevron open={showFolded} />
                </Pressable>
              )}
              {gameDays(view.games, view.timeZone).map((group) => {
                const games = group.games.filter((game) => !hidden.has(game.id));
                if (!games.length) return null;
                // A day made only of folded games appears as a whole when they are shown; in a day that was in
                // view, each folded game fades in where it sits.
                const dayFolded = games.every(isFolded);
                const cell = (game: Game) => (
                  <FadeIn
                    key={game.id}
                    from={-4}
                    enabled={!dayFolded && isFolded(game)}
                    style={grid.columns > 1 ? s.cell : undefined}
                  >
                    {renderGame(game)}
                  </FadeIn>
                );
                return (
                  <FadeIn key={group.day} from={-4} enabled={dayFolded} style={s.day}>
                    <View style={s.dayHead}>
                      <Text accessibilityRole="header" style={s.dayText}>
                        {group.day}
                      </Text>
                      {/* The zone once a day; each game says only its time. */}
                      <Text style={s.dayText}>
                        {kickoffZone(group.games[0]?.kickoff ?? "", view.timeZone)}
                      </Text>
                    </View>
                    {grid.columns === 1
                      ? games.map(cell)
                      : // Rows of two, read row by row, so kickoff order and tab order hold.
                        rowsOf(games, grid.columns).map((row) => (
                          <View key={row[0]?.id} style={s.gridRow}>
                            {row.map(cell)}
                            {row.length < grid.columns && <View style={s.cell} />}
                          </View>
                        ))}
                  </FadeIn>
                );
              })}
              {!draft.pow && !closed && hasPow && (
                <Text style={w.muted}>
                  {needsPow
                    ? `No POW chosen. Tap POW on a pick whose game hasn't locked yet; if you don't, you won't have one this ${unit}.`
                    : `No POW this ${unit}: every game has locked.`}
                </Text>
              )}
              <View style={{ gap: 0 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showLocks }}
                  aria-expanded={showLocks}
                  onPress={() => setShowLocks(!showLocks)}
                  // The fill reaches 8px past the text on each side without moving it.
                  style={(state) => [
                    w.row,
                    s.touch,
                    { marginHorizontal: -8, paddingHorizontal: 8, borderRadius: radius.md },
                    { backgroundColor: hoverFill(state) },
                    webTransition(["background-color"]),
                  ]}
                >
                  <Icon name="info" size={16} color={colors.mutedForeground} />
                  <Text style={s.disclosure}>How locks work</Text>
                  <Chevron open={showLocks} />
                </Pressable>
                {showLocks && (
                  <FadeIn from={-4}>
                    <Text style={[w.muted, { paddingBottom: 4 }]}>
                      {hasPow
                        ? `Each game locks at kickoff. Until then you can change your pick and put your POW on it or take it off. Once your POW's game kicks off, your POW stays there. It is worth ${powBonus} extra ${powBonus === 1 ? "point" : "points"} if it wins. If you don't choose a POW, you don't get one.`
                        : "The game locks at kickoff. Until then you can change your pick. The Super Bowl has no POW."}
                    </Text>
                  </FadeIn>
                )}
              </View>
              <Text style={w.muted}>
                Everyone's picks are revealed, and your points count, when the {unit} closes.
              </Text>
            </>
          )}
          {error && view.status !== "open" && (
            <View style={w.card}>
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
              <WeekAction label="Try again" onPress={() => void load()} />
            </View>
          )}
        </FadeIn>
      </ScrollView>
      {/* A player the guillotine put out has nothing to save but the Super Bowl guess. Once nothing can
          change, the bar goes too, unless it still has something to say. */}
      {showSaveBar && (
        <View style={s.savebar}>
          {!closed && <PickProgress picked={picked} total={view.games.length} />}
          <View style={s.saveContents}>
            <WeekAction
              label={saving ? "Saving…" : closed ? "Save guess" : "Save picks"}
              style={{ minWidth: 144 }}
              // Nothing to save until something changes; while saving it keeps the focus.
              disabled={!dirty && !saving}
              busy={saving}
              onPress={() => void save()}
            />
            {/* One height whatever it says, so nothing in the bar moves when the pill or a note appears. */}
            <View style={s.saveStatus}>
              <Text style={[w.muted, tabular]}>
                {closed ? "Your Super Bowl total guess" : `${picked} of ${view.games.length} picked`}
              </Text>
              {dirty && !message && !error && !savedNote && (
                <WeekBadge tone="primary">Unsaved changes</WeekBadge>
              )}
              {(savedNote || message || error) && (
                <SaveNote saved={error ? undefined : savedNote} message={error ?? message} error={!!error} />
              )}
            </View>
          </View>
        </View>
      )}
      {!embedded && !wide && <LeagueTabBar leagueId={view.leagueId} active={tab} />}
      <MatchupSheet game={insightGame} timeZone={view.timeZone} onClose={() => setInsightGame(null)} />
    </KeyboardAvoidingView>
  );
}

/** A disclosure's chevron: down when closed, up when open, turning (on the web) rather than flipping. */
function Chevron({ open }: { open: boolean }) {
  return (
    <View
      style={[
        { transform: [{ rotate: open ? "180deg" : "0deg" }] },
        webTransition(["transform"], duration.base),
      ]}
    >
      <Icon name="chevron-down" size={12} color={colors.mutedForeground} />
    </View>
  );
}

/** The week's placeholder: the shapes of what replaces it, the title, the status card, a day and its games. */
function WeekSkeleton() {
  return (
    <View accessibilityLabel="Loading week" accessibilityState={{ busy: true }} aria-busy style={s.sheet}>
      <SkeletonBlock width="45%" height={36} />
      <SkeletonBlock height={64} radius={radius.xl} />
      <SkeletonBlock width={120} height={16} style={{ marginTop: space.md }} />
      <SkeletonBlock height={140} radius={radius.xl} />
      <SkeletonBlock height={140} radius={radius.xl} />
    </View>
  );
}

/** The save bar's track: how many games have a pick, easing from one count to the next. */
function PickProgress({ picked, total }: { picked: number; total: number }) {
  const fraction = picked / Math.max(1, total);
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(fraction)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(fraction);
      return;
    }
    // A width (the one layout property the app animates): the web has no native driver for it either way.
    const timing = Animated.timing(value, {
      toValue: fraction,
      duration: duration.base,
      easing: easing.out,
      useNativeDriver: false,
    });
    timing.start();
    return () => timing.stop();
  }, [fraction, reduced, value]);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Games picked"
      accessibilityValue={{ min: 0, max: total, now: picked }}
      style={s.progress}
    >
      <Animated.View
        style={[
          s.progressFill,
          { width: value.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
        ]}
      />
    </View>
  );
}

/** What the save said: "Picks saved." with a check that lands, and any message beside it, or the error. */
function SaveNote({ saved, message, error }: { saved?: string; message?: string; error: boolean }) {
  const scale = usePop(!!saved);
  return (
    <View accessibilityRole={error ? "alert" : undefined} accessibilityLiveRegion="polite" style={s.note}>
      {saved && (
        <>
          <Animated.View style={{ transform: [{ scale }] }}>
            <Icon name="check-circle" size={14} color={colors.win} />
          </Animated.View>
          <Text style={[w.small, { color: colors.win }]}>{saved}</Text>
        </>
      )}
      {message && (
        <Text style={[w.small, { color: error ? colors.destructive : colors.win, flexShrink: 1 }]}>
          {message}
        </Text>
      )}
    </View>
  );
}

/**
 * A game's two team buttons and its POW, then its Stats & news row (kickoff time, points, the tiebreaker): the
 * card's controls, disabled once locked.
 */
function PickControls({
  game,
  draft,
  saved,
  locked,
  saving,
  hasPow,
  powFrozen,
  teamLayout,
  smallName,
  insightWords,
  timeZone,
  tiebreaker,
  notSavedId,
  flushBottom,
  onChoose,
  onPow,
  onInsight,
}: {
  game: Game;
  draft: PickDraft;
  /** What is saved, so a chosen side that isn't yet is marked as such. */
  saved: PickDraft;
  /** Kicked off, has a result, or the player is out of picking. */
  locked: boolean;
  saving: boolean;
  hasPow: boolean;
  /** The saved POW's game has kicked off, so the POW stays where it is. */
  powFrozen: boolean;
  /** Stacked (badge over name over line), or a row once a button is wide enough. */
  teamLayout: "stack" | "row";
  /** The narrowest phones: a stacked button's name a size down. */
  smallName: boolean;
  /** "Stats & news" in words beside its icon (the button's name says it either way). */
  insightWords: boolean;
  timeZone: string;
  /** This is the tiebreaker game. */
  tiebreaker: boolean;
  notSavedId: string;
  /** The Stats & news row is the card's last, so its fill reaches the card's bottom edge. */
  flushBottom: boolean;
  onChoose: (game: Game, side: Side) => void;
  onPow: (game: Game) => void;
  onInsight: (game: Game) => void;
}) {
  const powOn = draft.pow === game.id;
  const powOff = locked || powFrozen || !draft.sides[game.id];
  const describeId = `${notSavedId}-${game.id}`;
  const about = `Kickoff ${kickoffTime(game.kickoff, timeZone)}, ${game.points} ${game.points === 1 ? "point" : "points"}${tiebreaker ? ", tiebreaker game" : ""}`;
  return (
    <>
      <View style={s.pickRow}>
        {(["away", "home"] as const).map((side) => (
          <TeamButton
            key={side}
            game={game}
            side={side}
            selected={draft.sides[game.id] === side}
            saved={saved.sides[game.id] === side}
            locked={locked}
            saving={saving}
            teamLayout={teamLayout}
            smallName={smallName}
            notSavedId={notSavedId}
            onPress={() => onChoose(game, side)}
          />
        ))}
        {hasPow && (
          <PowButton game={game} on={powOn} off={powOff} saving={saving} onPress={() => onPow(game)} />
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Matchup: ${matchup(game)}`}
        {...describedBy(describeId, about)}
        onPress={() => onInsight(game)}
        style={(state) => [
          s.insights,
          flushBottom && s.insightsLast,
          { backgroundColor: hoverFill(state) },
          webTransition(["background-color"]),
          ringInside,
        ]}
      >
        <Description id={describeId}>{about}</Description>
        <Text numberOfLines={1} style={[w.muted, tabular]}>
          {kickoffTime(game.kickoff, timeZone, { zone: false })}
        </Text>
        <Badge small inline tone="primary">
          {game.points} {game.points === 1 ? "pt" : "pts"}
        </Badge>
        {tiebreaker && (
          <Badge small inline>
            Tiebreaker
          </Badge>
        )}
        <View style={{ flex: 1 }} />
        <Icon name="chart" size={16} color={colors.mutedForeground} filled />
        {insightWords && (
          <Text numberOfLines={1} style={s.disclosure}>
            Stats & news
          </Text>
        )}
        <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
      </Pressable>
    </>
  );
}

/**
 * One side of a game. Chosen, it fills with the primary color and carries a mark in its corner: a check once
 * that side is what is saved, a hollow ring while it is chosen but not saved yet. The mark lands as it appears.
 */
function TeamButton({
  game,
  side,
  selected,
  saved,
  locked,
  saving,
  teamLayout,
  smallName,
  notSavedId,
  onPress,
}: {
  game: Game;
  side: Side;
  selected: boolean;
  saved: boolean;
  locked: boolean;
  saving: boolean;
  teamLayout: "stack" | "row";
  smallName: boolean;
  notSavedId: string;
  onPress: () => void;
}) {
  const abbr = side === "home" ? game.homeTeam : game.awayTeam;
  const line = lineFor(side, game.spread ?? 0);
  const stored = selected && saved;
  const chosenPop = usePop(selected);
  const savedPop = usePop(stored);
  const off = locked || saving;
  const row = teamLayout === "row";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatLine(teamName(abbr), line)}${side === "home" ? ", home" : ""}`}
      accessibilityState={{ selected, disabled: off }}
      aria-pressed={selected}
      {...describedBy(selected && !saved ? notSavedId : undefined, "Not saved yet")}
      disabled={off}
      onPress={onPress}
      style={(state) => [
        s.team,
        row ? s.teamRow : s.teamStack,
        selected && s.selected,
        locked && !selected && s.disabled,
        !off && pressTile(state, selected),
        webTransition(["background-color", "opacity", "transform", "box-shadow"]),
      ]}
    >
      {selected && (
        <Animated.View
          style={[s.mark, row && s.markRow, { transform: [{ scale: stored ? savedPop : chosenPop }] }]}
        >
          <Icon name={stored ? "check-circle" : "circle"} size={16} color={colors.primaryForeground} />
        </Animated.View>
      )}
      <TeamLogo team={abbr} size={row ? 32 : 28} />
      <View style={row ? s.teamTextRow : s.teamTextStack}>
        <Text
          numberOfLines={1}
          style={[s.teamName, smallName && s.teamNameSmall, selected && s.selectedText]}
        >
          {teamName(abbr)}
        </Text>
        <Text numberOfLines={1} style={[s.line, tabular, selected && s.selectedText]}>
          {line === 0 ? "PK" : `${line > 0 ? "+" : ""}${line}`}
          {side === "home" ? " · home" : ""}
        </Text>
      </View>
    </Pressable>
  );
}

/** A game's POW: lit solid red once chosen (saved or not), landing as it lights. */
function PowButton({
  game,
  on,
  off,
  saving,
  onPress,
}: {
  game: Game;
  on: boolean;
  /** Can't be put on or taken off: locked, frozen elsewhere, or no pick on this game yet. */
  off: boolean;
  saving: boolean;
  onPress: () => void;
}) {
  const scale = usePop(on);
  const inert = off || saving;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`POW: ${matchup(game)}`}
      accessibilityState={{ selected: on, disabled: inert }}
      aria-pressed={on}
      disabled={inert}
      onPress={onPress}
      style={(state) => [
        s.pow,
        on && s.powSelected,
        off && !on && s.disabled,
        !inert && pressTile(state, on),
        webTransition(["background-color", "opacity", "transform", "box-shadow"]),
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text style={[s.powText, on && { color: colors.powForeground }]}>POW</Text>
      </Animated.View>
    </Pressable>
  );
}

/** The tiebreaker game's guess, in its card: a label and the field, on a raised strip. */
function GuessRow({
  rowRef,
  inputRef,
  game,
  value,
  disabled,
  onChange,
  onSubmit,
}: {
  rowRef: RefObject<ComponentRef<typeof View> | null>;
  inputRef: RefObject<ComponentRef<typeof TextInput> | null>;
  game: Game;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View ref={rowRef} style={s.guess}>
      <Text style={[w.muted, { flex: 1 }]}>Your guess at the total points</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={`Tiebreaker: total points scored in ${matchup(game)}`}
        accessibilityState={{ disabled }}
        value={value}
        editable={!disabled}
        // A whole number: letters and points are dropped as they're typed or pasted.
        onChangeText={onChange}
        inputMode="numeric"
        autoComplete="off"
        autoCorrect={false}
        returnKeyType="done"
        enterKeyHint="done"
        // Enter saves, as the save bar's button does (iPhone's number pad has no return key).
        onSubmitEditing={onSubmit}
        blurOnSubmit={!web}
        maxLength={3}
        placeholder="Total"
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        style={[s.guessInput, disabled && s.disabled]}
      />
    </View>
  );
}

/**
 * A game the player can no longer change, as one compact scoreboard row: each team's abbreviation and score
 * (the side that covered in full ink), the outcome (Won/Lost/Push, in words and icons, never color alone) or
 * Locked, then the pick with its POW and, at the right, Final or the kickoff time. Tapping it opens the full
 * card below the row, read-only, Stats & news included; tapping again closes it.
 */
function LockedGame({
  game,
  row,
  timeZone,
  guess,
  expanded,
  onToggle,
  children,
}: {
  game: Game;
  row: ReturnType<typeof lockedGameRow>;
  timeZone: string;
  /** The saved tiebreaker guess, on the tiebreaker game's row. */
  guess?: string;
  expanded: boolean;
  onToggle: () => void;
  /** The card's contents, shown while open. */
  children: ReactNode;
}) {
  const tone = row.outcome === "won" ? "win" : row.outcome === "lost" ? "loss" : "muted";
  const ink = (side: Side) =>
    row.covered === null || row.covered === "push" || row.covered === side
      ? colors.foreground
      : colors.mutedForeground;
  const team = (side: Side) => {
    const abbr = side === "home" ? game.homeTeam : game.awayTeam;
    const points = side === "home" ? game.homeScore : game.awayScore;
    return (
      <View style={s.scoreTeam}>
        <TeamLogo team={abbr} size={20} />
        <Text style={[s.abbr, { color: ink(side) }]}>{abbr}</Text>
        {row.score && <Text style={[s.abbr, tabular, { color: ink(side) }]}>{points}</Text>}
      </View>
    );
  };
  return (
    <View style={[s.gameCard, s.lockedCard]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.label}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={onToggle}
        style={(state) => [
          s.lockedHead,
          { backgroundColor: hoverFill(state) },
          webTransition(["background-color"]),
          ringInside,
        ]}
      >
        <View style={s.lockedLine}>
          <View style={s.scoreLine}>
            {team("away")}
            {team("home")}
          </View>
          {row.result ? (
            <Badge
              small
              inline
              tone={tone}
              icon={row.outcome === "won" ? "check" : row.outcome === "push" ? "equals" : undefined}
            >
              {row.result}
            </Badge>
          ) : (
            !row.score && (
              <Badge small inline icon="lock">
                Locked
              </Badge>
            )
          )}
          <Chevron open={expanded} />
        </View>
        <View style={s.lockedLine}>
          <View style={[w.row, { flex: 1, gap: 6, minWidth: 0 }]}>
            {row.pick ? (
              <>
                <Text
                  numberOfLines={1}
                  style={[s.rowPick, row.outcome === "lost" && s.lostPick, { flexShrink: 1 }]}
                >
                  {row.pick}
                </Text>
                {row.pow && (
                  <Badge tone="pow" small inline>
                    POW
                  </Badge>
                )}
              </>
            ) : (
              <Text style={w.small}>No pick</Text>
            )}
            {guess !== undefined && (
              <Text numberOfLines={1} style={[w.small, tabular, { flexShrink: 0 }]}>
                Your guess: {guess}
              </Text>
            )}
          </View>
          <Text style={[w.small, tabular]}>
            {row.score ? "Final" : kickoffTime(game.kickoff, timeZone, { zone: false })}
          </Text>
        </View>
      </Pressable>
      {expanded && (
        <FadeIn from={-4} style={s.lockedBody}>
          {children}
        </FadeIn>
      )}
    </View>
  );
}

/**
 * What is saved: how many games are still to pick (or what else is left to do), or that the player is set,
 * with the POW and the guess. Never what is changed but unsaved: the save bar says that. Under it, once any
 * game has a result, the player's tally; once nothing can change, the tally is the whole card.
 */
function PickStatusBanner({
  view,
  now,
  canChange,
  tally,
  onGuess,
}: {
  view: WeekView;
  now: Date;
  /** A game is still open to a pick: only then does "you can still change a pick" hold. */
  canChange: boolean;
  /** The running tally, under the status. */
  tally?: ReactNode;
  /** Takes the player to the tiebreaker's guess. */
  onGuess: () => void;
}) {
  if (tally && !canChange)
    return (
      <View accessibilityLabel="Pick status" style={[s.status, { backgroundColor: colors.card }]}>
        {tally}
      </View>
    );
  const { savedCount, left, missed, needsTotal, needsPow } = pickStatus(view, now);
  const extras = Number(needsTotal) + Number(needsPow);
  const complete = left === 0 && extras === 0;
  const savedLine = `${savedCount} of ${view.games.length} saved`;
  const pow = view.games.find((game) => game.id === savedDraft(view).pow);
  const title = complete
    ? `You're set for the ${weekUnit(view)}`
    : left
      ? `${left === 1 ? "game" : "games"} left to pick`
      : `${extras === 1 ? "thing" : "things"} left to do`;
  const detail = complete
    ? `${missed === 0 ? `All ${view.games.length} ${view.games.length === 1 ? "game" : "games"} picked and saved.` : `${savedLine}; ${missed} ${missed === 1 ? "game" : "games"} locked without a pick.`}${pow ? ` POW: ${matchup(pow)}.` : weekHasPow(view) ? ` No POW this ${weekUnit(view)}.` : ""}${canChange ? " You can still change a pick until kickoff." : ""}`
    : `${savedLine}.${needsPow ? " Choose your POW." : ""}`;
  return (
    <View
      accessibilityLabel="Pick status"
      style={[s.status, { backgroundColor: complete ? colors.winTint : colors.primaryTint }]}
    >
      <View style={s.statusMain}>
        {complete ? (
          <Icon name="check-circle" size={28} color={colors.win} />
        ) : (
          <View style={s.count}>
            <Text style={[s.countText, tabular]}>{left || extras}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.cardTitle, complete && { color: colors.win }]}>{title}</Text>
          <Text numberOfLines={2} style={w.muted}>
            {detail}
          </Text>
          {needsTotal && (
            <Pressable
              accessibilityRole="button"
              onPress={onGuess}
              // 24 tall and 10 more each way under a finger: a 44px target in a compact card.
              hitSlop={10}
              style={(state) => [s.guessLink, { opacity: state.pressed ? 0.7 : 1 }]}
            >
              <Text style={s.guessLinkText}>Add your tiebreaker guess</Text>
              <Icon name="arrow-right" size={14} color={colors.primaryText} />
            </Pressable>
          )}
        </View>
      </View>
      {tally && <View style={s.tallyUnder}>{tally}</View>}
    </View>
  );
}

/**
 * The player's own week so far, as a scoreboard strip: points, record, POW and what is still to play. One
 * sentence for screen readers, announced as it changes. Unofficial until the week closes (the footnote under
 * the slate says so).
 */
function Tally({
  unit,
  score,
  hasPow,
}: {
  unit: string;
  score: ReturnType<typeof scoreSoFar>;
  hasPow: boolean;
}) {
  const pow = score.pow
    ? ({ won: "won", lost: "lost", push: "push", pending: "to play" } as const)[score.pow]
    : "none";
  const left =
    score.pending === 0
      ? "all your games are in"
      : `${score.pending} ${score.pending === 1 ? "pick" : "picks"} still to play`;
  const cells: { label: string; value: string; color?: string }[] = [
    { label: "Points", value: String(score.points), color: score.points > 0 ? colors.win : undefined },
    { label: "Record", value: formatRecord(score) },
    ...(hasPow
      ? [
          {
            label: "POW",
            value: pow === "to play" ? "To play" : `${pow.charAt(0).toUpperCase()}${pow.slice(1)}`,
            color: score.pow === "won" ? colors.win : undefined,
          },
        ]
      : []),
    { label: "To play", value: String(score.pending) },
  ];
  return (
    <View
      accessibilityLabel={`Your ${unit} so far: ${score.points} ${score.points === 1 ? "point" : "points"}, record ${formatRecord(score)}${hasPow ? `, POW ${pow}` : ""}, ${left}`}
      accessibilityLiveRegion="polite"
      style={s.tally}
    >
      {cells.map((cell) => (
        <View key={cell.label} style={s.tallyCell}>
          <Text style={s.tallyLabel}>{cell.label}</Text>
          <Text numberOfLines={1} style={[s.tallyValue, cell.color ? { color: cell.color } : undefined]}>
            {cell.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const { gap, cardPad, powWidth } = PICK_GRID;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // The same insets as every league tab (leagueUi's s.content), so the league header doesn't jump between tabs.
  initial: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: layout.pageX,
    paddingTop: layout.pageTop,
    gap: 16,
    width: "100%",
    maxWidth: widths.page,
    alignSelf: "center",
  },
  sheet: { gap: 16 },
  initialSheet: {
    flex: 1,
    gap: 16,
    paddingHorizontal: layout.pageX,
    paddingTop: layout.pageTop,
    width: "100%",
    maxWidth: widths.page,
    alignSelf: "center",
  },
  skeletonBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: layout.pageX,
    paddingVertical: 14,
    backgroundColor: colors.chrome,
  },
  hidden: { display: "none" },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { ...type.title, color: colors.foreground },
  year: { ...type.heading, color: colors.mutedForeground },
  titleEnd: { flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1 },
  // Pushed to the row's end, whichever line that is.
  manage: { marginLeft: "auto" },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20, color: colors.foreground },
  status: { ...corner(radius.xl), padding: 12, gap: 10 },
  statusMain: { flexDirection: "row", alignItems: "center", gap: 12 },
  count: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryTintStrong,
  },
  countText: { ...type.heading, fontFamily: fonts.displayExtraBold, color: colors.primaryText },
  guessLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 24, alignSelf: "flex-start" },
  guessLinkText: { ...type.small, fontFamily: fonts.semibold, color: colors.primaryText },
  tallyUnder: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tally: { flexDirection: "row", gap: 8 },
  // Each cell as wide as it needs, the room left shared out: "To play" takes more than "0".
  tallyCell: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0, gap: 2 },
  tallyLabel: { ...type.caption, color: colors.mutedForeground },
  tallyValue: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 28,
    color: colors.foreground,
    ...tabular,
  },

  touch: { minHeight: 44, alignSelf: "flex-start" },
  disclosure: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: colors.mutedForeground },
  day: { gap },
  dayHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  dayText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
  gridRow: { flexDirection: "row", alignItems: "flex-start", gap },
  cell: { flex: 1, minWidth: 0 },
  gameCard: {
    backgroundColor: colors.card,
    ...corner(radius.xl),
    padding: cardPad,
    gap: space.sm,
    overflow: "hidden",
    boxShadow: elevation.cardEdge,
  },
  lockedCard: { padding: 0, gap: 0 },
  lockedHead: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  lockedLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  scoreLine: { flexDirection: "row", alignItems: "center", flex: 1, gap: 16, minWidth: 0 },
  scoreTeam: { flexDirection: "row", alignItems: "center", gap: 6 },
  lockedBody: { paddingHorizontal: cardPad, paddingBottom: cardPad, gap: space.sm },
  abbr: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 20, color: colors.foreground },
  rowPick: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.foreground },
  lostPick: { textDecorationLine: "line-through", color: colors.mutedForeground },
  fold: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
  },
  pickRow: { flexDirection: "row", alignItems: "stretch", gap },
  team: { flex: 1, minWidth: 0, ...corner(radius.lg), backgroundColor: colors.raised },
  teamStack: {
    minHeight: 86,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 2,
  },
  // The right padding keeps the name clear of the mark in the corner.
  teamRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 20,
    paddingVertical: 8,
    gap: 8,
  },
  teamTextStack: { alignItems: "center", alignSelf: "stretch" },
  teamTextRow: { flex: 1, minWidth: 0, alignItems: "flex-start" },
  selected: { backgroundColor: colors.primary, boxShadow: elevation.glowPrimary },
  selectedText: { color: colors.primaryForeground },
  mark: { position: "absolute", top: 6, right: 6 },
  markRow: { top: 4, right: 4 },
  teamName: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 0.2,
    color: colors.foreground,
  },
  teamNameSmall: { fontSize: 16, lineHeight: 20 },
  line: { ...type.small, fontFamily: fonts.medium, lineHeight: 18, color: colors.foreground },
  pow: {
    width: powWidth,
    ...corner(radius.lg),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  powSelected: { backgroundColor: colors.powFill, boxShadow: elevation.glowPow },
  powText: {
    fontFamily: fonts.displayExtraBold,
    fontSize: 16,
    letterSpacing: 0.8,
    color: colors.mutedForeground,
  },
  disabled: { opacity: disabledOpacity },
  insights: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    minHeight: 44,
    marginHorizontal: -cardPad,
    paddingHorizontal: cardPad,
  },
  insightsLast: { marginBottom: -cardPad },
  guess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
  },
  guessInput: {
    ...type.body,
    fontFamily: fonts.semibold,
    fontSize: 18,
    ...tabular,
    textAlign: "center",
    color: colors.foreground,
    backgroundColor: colors.field,
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 8,
    width: 88,
  },
  savebar: {
    backgroundColor: colors.chrome,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    boxShadow: elevation.bar,
  },
  // Full width on a phone; on a wide screen as wide as the cards above it.
  progress: {
    height: 4,
    width: "100%",
    maxWidth: widths.page - 2 * layout.pageX,
    alignSelf: "center",
    backgroundColor: colors.raised,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderTopRightRadius: radius.xs,
    borderBottomRightRadius: radius.xs,
  },
  saveContents: {
    width: "100%",
    maxWidth: widths.page,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: layout.pageX,
    paddingVertical: 12,
  },
  // The count line (20), the gap (4) and the pill (24).
  saveStatus: { flex: 1, gap: 4, minHeight: 48, justifyContent: "center" },
  // As tall as the pill it replaces.
  note: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, minHeight: 24 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.destructive },
});
