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
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
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
import { Icon } from "../components/Icon";
import { NotFound } from "../components/NotFound";
import { hoverFill, pressState, ringInside } from "../components/pressState";
import { TeamLogo } from "../components/TeamLogo";
import { colors, fonts } from "../components/ui";
import { request, statusOf } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now as clockNow } from "../lib/clock";
import { haptics } from "../lib/haptics";
import { offerHomeScreen } from "../lib/homeScreen";
import { onlyDigits } from "../lib/leagueLogic";
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
  lockedGameRow,
  pickStatus,
  sheetEditable,
  weekHasPow,
  weekUnit,
} from "../lib/weekPresentation";
import { LeagueHeader, LeagueTabBar } from "./LeagueChrome";
import { MatchupSheet } from "./MatchupSheet";
import { PlayoffStatusLine } from "./playoff/PlayoffStatus";
import { WeekResults } from "./WeekResults";
import { WeekAction, WeekBadge, w } from "./weekUi";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
const undoMessage = (undone: string[]) =>
  `Changes to ${undone.join(", ")} were undone because the game locked or was removed.`;
const EMPTY: PickDraft = { sides: {}, pow: null, total: "" };

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
  const wide = useWindowDimensions().width >= 768;
  const [view, setView] = useState<WeekView>();
  const [draft, setDraft] = useState<PickDraft>(EMPTY);
  const [error, setError] = useState<string>();
  // The failed load's HTTP status: 404 is a week that is gone or not the player's to see.
  const [errorStatus, setErrorStatus] = useState<number>();
  const [message, setMessage] = useState<string>();
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
  const dirty = view?.status === "open" && draftChanged(draft, savedDraft(view));
  useUnsavedWork(!!dirty, () => {
    const current = viewRef.current;
    if (!current) return;
    const next = savedDraft(current);
    draftRef.current = next;
    setDraft(next);
    setMessage(undefined);
    setError(undefined);
  });
  useRemovalGuard(!!dirty, saving);

  const updateDraft = useCallback((next: PickDraft) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const accept = useCallback(
    (next: WeekView, reset = false) => {
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
    [updateDraft],
  );
  const load = useCallback(async () => {
    if (savingRef.current) return;
    const id = ++serial.current;
    try {
      const next = await request<WeekView>(`/weeks/${weekId}`);
      if (active.current && serial.current === id) {
        accept(next);
        setError(undefined);
        setErrorStatus(undefined);
      }
    } catch (err) {
      if (active.current && serial.current === id) {
        setError(errorText(err));
        setErrorStatus(statusOf(err));
      }
    }
  }, [weekId, accept]);
  // The spinner shows for the player's own pull only, never for the minute-by-minute refresh.
  const pull = usePullRefresh(() => Promise.all([load(), refreshAlso?.()]));
  const scrollRef = useScrollRestore();
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
    setMessage(undefined);
    setError(undefined);
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
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    serial.current += 1;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      // Refresh the slate before reconciling: an admin may have removed or moved a game.
      const latest = await request<WeekView>(`/weeks/${weekId}`);
      if (!active.current) return;
      if (latest.status !== "open") {
        accept(latest, true);
        setMessage(`This ${weekUnit(latest)} is no longer accepting picks.`);
        haptics.warn();
        return;
      }
      const reconciled = reconcileDraft(draftRef.current, latest, clockNow());
      accept(latest);
      updateDraft(reconciled.draft);
      const parsed = submitPicksSchema.safeParse(draftSubmission(reconciled.draft));
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check your picks.");
        haptics.error();
        return;
      }
      const result = await request<WeekView>(`/weeks/${weekId}/picks`, { method: "PUT", body: parsed.data });
      if (!active.current) return;
      accept(result, true);
      // A playoff player the guillotine put out saves only their Super Bowl guess.
      const what = result.playoff?.mayPick === false ? "Guess saved." : "Picks saved.";
      setMessage(`${what}${reconciled.undone.length ? ` ${undoMessage(reconciled.undone)}` : ""}`);
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
        {header}
        {error ? (
          <View style={w.stack}>
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
            <WeekAction label="Try again" onPress={() => void load()} />
          </View>
        ) : (
          <View accessibilityLabel="Loading week" accessibilityState={{ busy: true }} style={w.stack}>
            <View style={[s.placeholder, { height: 58, width: "60%" }]} />
            {[1, 2, 3].map((id) => (
              <View key={id} style={[s.placeholder, { height: 174 }]} />
            ))}
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
  const foldable = view.games.filter((game) => folded.current?.ids.has(game.id) && gameLocked(game, now));
  const folding = foldable.length > 0 && !showFolded;
  const hidden = new Set(folding ? foldable.map((game) => game.id) : []);
  const foldLabel = `${foldable.length} ${foldable.length === 1 ? "game" : "games"} locked`;
  // The running tally sits inside the status card (or alone for a player the guillotine put out), one line.
  const soFar =
    score.wins + score.losses + score.pushes > 0 ? (
      <SoFarLine unit={unit} score={score} hasPow={hasPow} />
    ) : null;
  const toggleRow = (id: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
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
        {!embedded && <LeagueHeader leagueId={view.leagueId} leagueName={view.leagueName} />}
        {!embedded && wide && <LeagueTabBar wide leagueId={view.leagueId} active={tab} />}
        <View style={[w.between, { alignItems: "flex-end" }]}>
          <View style={{ gap: 8, flexShrink: 1 }}>
            <WeekBadge tone={view.status === "open" ? "primary" : "outline"}>
              {WEEK_PHASE_LABEL[phase]}
            </WeekBadge>
            <Text
              accessibilityRole="header"
              accessibilityLabel={`${weekLabel(view.number)} · ${view.year}`}
              style={s.title}
            >
              {weekLabel(view.number)}
              {!embedded && <Text style={s.year}> · {view.year}</Text>}
            </Text>
          </View>
          {view.role === "admin" && (
            <WeekAction label={`Manage ${unit}`} href={`/weeks/${weekId}/manage`} secondary compact />
          )}
        </View>
        {/* In the Picks tab the league's own card above says this, with the commissioner's Review & finalize. */}
        {phase === "awaiting" && !embedded && (
          <View style={w.card}>
            <Text style={s.cardTitle}>Awaiting finalization</Text>
            <Text style={w.muted}>
              {automatic
                ? "All final scores are in. It finalizes by itself in a few minutes; picks stay private until then."
                : "All final scores are entered. Picks stay private and this week does not count in standings until the commissioner finalizes it."}
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
              <PickStatusBanner view={view} dirty={dirty} now={now} canChange={editable.games}>
                {soFar}
              </PickStatusBanner>
            ) : (
              soFar && <View style={w.card}>{soFar}</View>
            )}
            {foldable.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={foldLabel}
                accessibilityState={{ expanded: showFolded }}
                aria-expanded={showFolded}
                onPress={() => setShowFolded(!showFolded)}
                style={(state) => [s.fold, { backgroundColor: hoverFill(state, colors.card) }]}
              >
                <Icon name="lock" size={16} color={colors.mutedForeground} />
                <Text style={[s.disclosure, { flex: 1 }]}>{foldLabel}</Text>
                <Text style={s.disclosure}>{showFolded ? "Hide" : "Show"}</Text>
                <View style={{ transform: [{ rotate: showFolded ? "180deg" : "0deg" }] }}>
                  <Icon name="chevron-down" size={12} color={colors.mutedForeground} />
                </View>
              </Pressable>
            )}
            {gameDays(view.games, view.timeZone).map((group) => {
              const games = group.games.filter((game) => !hidden.has(game.id));
              if (!games.length) return null;
              return (
                <View key={group.day} style={{ gap: 8 }}>
                  <Text accessibilityRole="header" style={s.day}>
                    {group.day}
                  </Text>
                  {games.map((game) => {
                    // Kicked off (or has a result): nothing on it can change, so it is a compact row that opens
                    // to the card. A player the guillotine put out can't pick the rest either, but those games
                    // aren't locked: they stay cards, and the status line above says why.
                    const kickedOff = gameLocked(game, now);
                    const controls = (
                      <PickControls
                        game={game}
                        draft={draft}
                        locked={closed || kickedOff}
                        saving={saving}
                        hasPow={hasPow}
                        powFrozen={powFrozen}
                        onChoose={choose}
                        onPow={togglePow}
                        onInsight={setInsightGame}
                      />
                    );
                    const meta = (
                      <View style={s.gameMeta}>
                        <Text style={[w.muted, { marginRight: "auto" }]}>
                          {kickoffTime(game.kickoff, view.timeZone)}
                        </Text>
                        {game.id === view.tiebreakerGameId && <WeekBadge>Tiebreaker game</WeekBadge>}
                        <WeekBadge tone="primary">
                          {game.points} {game.points === 1 ? "pt" : "pts"}
                        </WeekBadge>
                      </View>
                    );
                    if (kickedOff)
                      return (
                        <LockedGame
                          key={game.id}
                          game={game}
                          row={lockedGameRow(game, saved, { hasPow, powBonus: view.powBonus })}
                          expanded={expanded.has(game.id)}
                          onToggle={() => toggleRow(game.id)}
                        >
                          {meta}
                          {controls}
                        </LockedGame>
                      );
                    return (
                      <View key={game.id} style={s.gameCard}>
                        {meta}
                        {controls}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {tiebreaker && (
              <View style={[w.card, { gap: 8, marginTop: 8 }]}>
                <Text style={s.cardTitle}>Tiebreaker: total points scored in {matchup(tiebreaker)}</Text>
                <TextInput
                  accessibilityLabel={`Tiebreaker: total points scored in ${matchup(tiebreaker)}`}
                  accessibilityState={{ disabled: gameLocked(tiebreaker, now) || saving }}
                  value={draft.total}
                  editable={!gameLocked(tiebreaker, now) && !saving}
                  // A whole number: letters and points are dropped as they're typed or pasted.
                  onChangeText={(total) => edit({ ...draftRef.current, total: onlyDigits(total) })}
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect={false}
                  returnKeyType="done"
                  enterKeyHint="done"
                  // Enter saves, as the save bar's button does (iPhone's number pad has no return key).
                  onSubmitEditing={() => {
                    if (dirty) void save();
                  }}
                  blurOnSubmit={Platform.OS !== "web"}
                  maxLength={3}
                  placeholder="Total"
                  placeholderTextColor={colors.mutedForeground}
                  selectionColor={colors.primary}
                  style={[s.input, (gameLocked(tiebreaker, now) || saving) && s.disabled]}
                />
              </View>
            )}
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
                  { marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10 },
                  { backgroundColor: hoverFill(state) },
                ]}
              >
                <Icon name="info" size={16} color={colors.mutedForeground} />
                <Text style={s.disclosure}>How locks work</Text>
                <View style={{ transform: [{ rotate: showLocks ? "180deg" : "0deg" }] }}>
                  <Icon name="chevron-down" size={12} color={colors.mutedForeground} />
                </View>
              </Pressable>
              {showLocks && (
                <Text style={[w.muted, { paddingBottom: 4 }]}>
                  {hasPow
                    ? `Each game locks at kickoff. Until then you can change your pick and put your POW on it or take it off. Once your POW's game kicks off, your POW stays there. It is worth ${powBonus} extra ${powBonus === 1 ? "point" : "points"} if it wins. If you don't choose a POW, you don't get one.`
                    : "The game locks at kickoff. Until then you can change your pick. The Super Bowl has no POW."}
                </Text>
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
      </ScrollView>
      {/* A player the guillotine put out has nothing to save but the Super Bowl guess. Once nothing can
          change, the bar goes too, unless it still has something to say. */}
      {showSaveBar && (
        <View style={s.savebar}>
          {!closed && (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Games picked"
              accessibilityValue={{ min: 0, max: view.games.length, now: picked }}
              style={s.progress}
            >
              <View
                style={[s.progressFill, { width: `${(picked / Math.max(1, view.games.length)) * 100}%` }]}
              />
            </View>
          )}
          <View style={s.saveContents}>
            <WeekAction
              label={saving ? "Saving…" : closed ? "Save guess" : "Save picks"}
              style={{ minWidth: 144 }}
              // Nothing to save until something changes; while saving it keeps the focus.
              disabled={!dirty && !saving}
              busy={saving}
              onPress={() => void save()}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={w.muted}>
                {closed ? "Your Super Bowl total guess" : `${picked} of ${view.games.length} picked`}
              </Text>
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
      {!embedded && !wide && <LeagueTabBar leagueId={view.leagueId} active={tab} />}
      <MatchupSheet game={insightGame} timeZone={view.timeZone} onClose={() => setInsightGame(null)} />
    </KeyboardAvoidingView>
  );
}

/** A game's two team buttons, its POW and its Stats & news row: the card's controls, disabled once locked. */
function PickControls({
  game,
  draft,
  locked,
  saving,
  hasPow,
  powFrozen,
  onChoose,
  onPow,
  onInsight,
}: {
  game: Game;
  draft: PickDraft;
  /** Kicked off, has a result, or the player is out of picking. */
  locked: boolean;
  saving: boolean;
  hasPow: boolean;
  /** The saved POW's game has kicked off, so the POW stays where it is. */
  powFrozen: boolean;
  onChoose: (game: Game, side: Side) => void;
  onPow: (game: Game) => void;
  onInsight: (game: Game) => void;
}) {
  const powOn = draft.pow === game.id;
  const powOff = locked || powFrozen || !draft.sides[game.id];
  return (
    <>
      <View style={s.pickRow}>
        {(["away", "home"] as const).map((side) => {
          const abbr = side === "home" ? game.homeTeam : game.awayTeam;
          const selected = draft.sides[game.id] === side;
          const line = lineFor(side, game.spread ?? 0);
          return (
            <Pressable
              key={side}
              accessibilityRole="button"
              accessibilityLabel={`${formatLine(teamName(abbr), line)}${side === "home" ? ", home" : ""}`}
              accessibilityState={{ selected, disabled: locked || saving }}
              aria-pressed={selected}
              disabled={locked || saving}
              onPress={() => onChoose(game, side)}
              style={(state) => {
                const { pressed, hovered } = pressState(state);
                const live = hovered && !locked && !saving;
                return [
                  s.team,
                  live && !selected && { backgroundColor: colors.raisedHover },
                  selected && s.selected,
                  live && selected && { opacity: 0.9 },
                  locked && !selected && s.disabled,
                  pressed && s.pressed,
                ];
              }}
            >
              {selected && (
                <View style={s.chosen}>
                  <Icon name="check-circle" size={16} color={colors.primaryForeground} />
                </View>
              )}
              <TeamLogo team={abbr} size={36} />
              <View style={{ gap: 2, alignItems: "center" }}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[s.teamName, selected && s.selectedText]}
                >
                  {teamName(abbr)}
                </Text>
                <Text style={[s.line, selected && s.selectedText]}>
                  {line === 0 ? "PK" : `${line > 0 ? "+" : ""}${line}`}
                  {side === "home" ? " · home" : ""}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {hasPow && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`POW: ${matchup(game)}`}
            accessibilityState={{ selected: powOn, disabled: powOff || saving }}
            aria-pressed={powOn}
            disabled={powOff || saving}
            onPress={() => onPow(game)}
            style={(state) => {
              const { pressed, hovered } = pressState(state);
              const live = hovered && !powOff && !saving;
              return [
                s.pow,
                live && !powOn && { backgroundColor: colors.raisedHover },
                powOn && s.powSelected,
                live && powOn && { opacity: 0.9 },
                powOff && !powOn && s.disabled,
                pressed && s.pressed,
              ];
            }}
          >
            <Text style={[s.powText, powOn && { color: colors.powForeground }]}>POW</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Matchup: ${matchup(game)}`}
        onPress={() => onInsight(game)}
        style={(state) => [s.insights, { backgroundColor: hoverFill(state) }]}
      >
        <Icon name="chart" size={16} color={colors.mutedForeground} filled />
        <Text style={[s.disclosure, { flex: 1 }]}>Stats & news</Text>
        <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
      </Pressable>
    </>
  );
}

/**
 * A game the player can no longer change, as one compact row: the matchup, Locked or the final score, their
 * pick with its line and POW, and Won/Lost/Push (in words and icons, never color alone) or No pick. Tapping it
 * opens the full card below the row, read-only, Stats & news included; tapping again closes it.
 */
function LockedGame({
  game,
  row,
  expanded,
  onToggle,
  children,
}: {
  game: Game;
  row: ReturnType<typeof lockedGameRow>;
  expanded: boolean;
  onToggle: () => void;
  /** The card's contents, shown while open. */
  children: ReactNode;
}) {
  const tone = row.outcome === "won" ? "win" : row.outcome === "lost" ? "loss" : "outline";
  return (
    <View style={[s.gameCard, s.lockedCard]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.label}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={onToggle}
        style={(state) => [s.lockedHead, { backgroundColor: hoverFill(state) }, ringInside]}
      >
        <View style={s.lockedLine}>
          <View style={[w.row, { flex: 1, gap: 6 }]}>
            <TeamLogo team={game.awayTeam} size={20} />
            <Text style={s.abbr}>{game.awayTeam}</Text>
            <Text style={w.small}>at</Text>
            <TeamLogo team={game.homeTeam} size={20} />
            <Text style={s.abbr}>{game.homeTeam}</Text>
          </View>
          {row.score ? (
            <WeekBadge small>Final {row.score}</WeekBadge>
          ) : (
            <WeekBadge small icon="lock">
              Locked
            </WeekBadge>
          )}
          <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
            <Icon name="chevron-down" size={12} color={colors.mutedForeground} />
          </View>
        </View>
        <View style={s.lockedLine}>
          <View style={[w.row, { flex: 1, gap: 6, minWidth: 0 }]}>
            {row.pick ? (
              <>
                <Text style={w.small}>Your pick</Text>
                <Text
                  numberOfLines={1}
                  style={[s.rowPick, row.outcome === "lost" && s.lostPick, { flexShrink: 1 }]}
                >
                  {row.pick}
                </Text>
                {row.pow && (
                  <WeekBadge tone="pow" small>
                    POW
                  </WeekBadge>
                )}
              </>
            ) : (
              <Text style={w.small}>No pick</Text>
            )}
          </View>
          {row.result && (
            <WeekBadge
              small
              tone={tone}
              icon={row.outcome === "won" ? "check" : row.outcome === "push" ? "equals" : undefined}
            >
              {row.result}
            </WeekBadge>
          )}
        </View>
      </Pressable>
      {expanded && <View style={s.lockedBody}>{children}</View>}
    </View>
  );
}

function PickStatusBanner({
  view,
  dirty,
  now,
  canChange,
  children,
}: {
  view: WeekView;
  dirty: boolean;
  now: Date;
  /** A game is still open to a pick: only then does "you can still change a pick" hold. */
  canChange: boolean;
  /** The running tally, under the status. */
  children?: ReactNode;
}) {
  const { savedCount, left, missed, needsTotal, needsPow } = pickStatus(view, now);
  const extras = Number(needsTotal) + Number(needsPow);
  const complete = left === 0 && extras === 0;
  const savedLine = `${savedCount} of ${view.games.length} saved`;
  const pow = view.games.find((game) => game.id === savedDraft(view).pow);
  const title = dirty
    ? "Not saved yet"
    : complete
      ? `You're set for the ${weekUnit(view)}`
      : left
        ? `${left === 1 ? "game" : "games"} left to pick`
        : `${extras === 1 ? "thing" : "things"} left to do`;
  const detail = dirty
    ? `You've made changes. Press Save to keep them. ${savedLine} so far.`
    : complete
      ? `${missed === 0 ? `All ${view.games.length} ${view.games.length === 1 ? "game" : "games"} picked and saved.` : `${savedLine}; ${missed} ${missed === 1 ? "game" : "games"} locked without a pick.`}${pow ? ` POW: ${matchup(pow)}.` : weekHasPow(view) ? ` No POW this ${weekUnit(view)}.` : ""}${canChange ? " You can still change a pick until kickoff." : ""}`
      : `${savedLine}.${needsPow ? " Choose your POW." : ""}${needsTotal ? " Add your tiebreaker guess." : ""}`;
  const tone = dirty ? colors.destructive : complete ? colors.win : colors.primary;
  return (
    <View accessibilityLabel="Pick status" style={[s.status, { backgroundColor: `${tone}1a` }]}>
      {dirty || complete ? (
        <Icon name={dirty ? "pencil" : "check-circle"} size={28} color={tone} />
      ) : (
        <View style={[s.count, { backgroundColor: `${tone}26` }]}>
          <Text style={[s.countText, { color: tone }]}>{left || extras}</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.cardTitle, complete && !dirty && { color: colors.win }]}>{title}</Text>
        <Text style={w.muted}>{detail}</Text>
        {children && <View style={s.soFar}>{children}</View>}
      </View>
    </View>
  );
}

/**
 * The player's own week so far, in one line: points, record, POW and what is still to play. Unofficial until
 * the week closes (the footnote under the slate says so).
 */
function SoFarLine({
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
  const dot = <Text style={w.muted}> · </Text>;
  return (
    <Text
      accessibilityLabel={`Your ${unit} so far: ${score.points} ${score.points === 1 ? "point" : "points"}, record ${formatRecord(score)}${hasPow ? `, POW ${pow}` : ""}, ${left}`}
      accessibilityLiveRegion="polite"
      style={w.muted}
    >
      <Text style={s.soFarTitle}>Your {unit} so far: </Text>
      <Text style={[s.soFarValue, score.points > 0 && { color: colors.win }]}>
        {score.points} {score.points === 1 ? "pt" : "pts"}
      </Text>
      {dot}
      <Text style={s.soFarValue}>{formatRecord(score)}</Text>
      {hasPow && (
        <>
          {dot}
          <Text
            style={[
              s.soFarValue,
              score.pow === "won" && { color: colors.win },
              score.pow === "pending" && { color: colors.pow },
            ]}
          >
            POW {pow}
          </Text>
        </>
      )}
      {dot}
      {score.pending === 0 ? "All in" : `${score.pending} to play`}
    </Text>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // The same insets as every league tab (leagueUi's s.content), so the league header doesn't jump between tabs.
  initial: { flex: 1, paddingHorizontal: 16, paddingTop: 20, backgroundColor: colors.background, gap: 16 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 16,
    width: "100%",
    maxWidth: 896,
    alignSelf: "center",
  },
  leagueLink: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  title: {
    textTransform: "uppercase",
    fontFamily: fonts.displayExtraBold,
    fontSize: 48,
    lineHeight: 48,
    color: colors.foreground,
  },
  year: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 28, color: colors.mutedForeground },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20, color: colors.foreground },
  status: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 12 },
  count: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  countText: { fontFamily: fonts.displayExtraBold, fontSize: 30, lineHeight: 32 },

  touch: { minHeight: 44, alignSelf: "flex-start" },
  disclosure: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: colors.mutedForeground },
  day: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.mutedForeground,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  gameCard: { backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 12, overflow: "hidden" },
  gameMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  soFar: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  soFarTitle: { fontFamily: fonts.medium, color: colors.mutedForeground },
  soFarValue: { fontFamily: fonts.semibold, color: colors.foreground, fontVariant: ["tabular-nums"] },
  lockedCard: { padding: 0, gap: 0 },
  lockedHead: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  lockedLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  lockedBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 12 },
  abbr: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 20, color: colors.foreground },
  rowPick: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.foreground },
  lostPick: { textDecorationLine: "line-through", color: colors.mutedForeground },
  fold: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pickRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  team: {
    flex: 1,
    minHeight: 110,
    borderRadius: 12,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 4,
  },
  selected: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 0.25,
  },
  selectedText: { color: colors.primaryForeground },
  chosen: { position: "absolute", top: 6, right: 6 },
  teamName: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 22,
    color: colors.foreground,
  },
  line: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colors.foreground, opacity: 0.75 },
  pow: {
    width: 56,
    minHeight: 110,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  powSelected: {
    backgroundColor: colors.pow,
    shadowColor: colors.pow,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 0.3,
  },
  powText: {
    fontFamily: fonts.displayExtraBold,
    fontSize: 16,
    letterSpacing: 0.8,
    color: colors.mutedForeground,
  },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.98 }] },
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
  input: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.foreground,
    backgroundColor: colors.raised,
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    width: 128,
  },
  savebar: {
    backgroundColor: colors.chrome,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  progress: { height: 4, backgroundColor: colors.raised },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
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
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.destructive },
  placeholder: { borderRadius: 16, backgroundColor: colors.card },
});
