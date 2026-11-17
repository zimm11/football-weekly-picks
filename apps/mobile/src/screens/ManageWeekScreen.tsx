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
  weekPhase,
  zonedParts,
} from "@picks/shared";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Menu, MenuItem, useAnchor } from "../components/Popover";
import { TeamLogo } from "../components/TeamLogo";
import { fonts } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now } from "../lib/clock";
import { type GameDraft, gameChanges, parseLeagueKickoff } from "../lib/leagueLogic";
import { announceMessagesChanged } from "../lib/messageUnread";
import { notifyDone, notifyError } from "../lib/notify";
import { rememberSeason } from "../lib/seasonSelection";
import { confirmDiscard } from "../lib/unsaved";
import { LeagueHeader, LeagueTabBar } from "./LeagueChrome";
import { timeZones } from "./LeagueTools";
import {
  Action,
  Card,
  colors,
  confirm,
  Eyebrow,
  Failure,
  go,
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

export function ManageWeekScreen({ weekId }: { weekId: string }) {
  const { me } = useAuth();
  const week = useLeagueLoad(() => request<WeekView>(`/weeks/${weekId}`), weekId);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState<{ title: string; body: string }>();
  const [editorVersion, setEditorVersion] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, GameDraft>>({});
  const { width } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [resultsY, setResultsY] = useState(0);
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
      if (action === "open" || action === "finalize") {
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
        <Heading>Week management</Heading>
        <Text style={s.text}>Only league admins can manage a week.</Text>
        <Action link onPress={() => go(`/weeks/${weekId}`)}>
          Go to the week
        </Action>
      </View>
    );
  const missing = view.games.filter((game) => game.homeScore === null || game.awayScore === null).length;
  return (
    <View style={s.page}>
      <ScrollView
        ref={scroll}
        style={s.page}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={week.reload} />}
      >
        <LeagueHeader leagueId={view.leagueId} leagueName={view.leagueName} />
        {width >= 768 && <LeagueTabBar wide leagueId={view.leagueId} active="league" />}
        {announcement && (
          <Announcement
            view={view}
            initial={announcement}
            close={() => setAnnouncement(undefined)}
            showResults={() => scroll.current?.scrollTo({ y: resultsY, animated: true })}
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
            <Text
              accessibilityRole="header"
              style={{
                fontFamily: fonts.displayExtraBold,
                fontSize: 48,
                lineHeight: 46,
                color: colors.foreground,
                textTransform: "uppercase",
              }}
            >
              Week {view.number}{" "}
              <Text style={{ fontFamily: fonts.displayBold, fontSize: 24, color: colors.mutedForeground }}>
                · {view.year}
              </Text>
            </Text>
          </View>
          {view.status !== "draft" && (
            <Action link compact secondary onPress={() => go(`/weeks/${weekId}`)}>
              {view.status === "open" ? "Make your own picks" : "See the week as players do"}
            </Action>
          )}
        </View>
        <Card label="Week admin">
          <Eyebrow>Manage week</Eyebrow>
          {view.status === "draft" && (
            <>
              <Label>
                Players can't see this week yet. Check the games and spreads, then open it. Spreads stay fixed
                once the week is open unless you change them here.
              </Label>
              <Action
                disabled={!!busy || !view.games.length}
                onPress={() => {
                  void act("open", `/weeks/${weekId}/open`);
                }}
              >
                {busy === "open" ? "Opening…" : "Open week for picks"}
              </Action>
              <Action
                secondary
                disabled={!!busy}
                onPress={() => {
                  const run = () => {
                    void act("import", `/weeks/${weekId}/import`);
                  };
                  if (view.games.length)
                    confirm(
                      "Refresh from ESPN?",
                      "Kickoffs and spreads changed by hand will be replaced.",
                      "Refresh",
                      run,
                    );
                  else run();
                }}
              >
                {busy === "import"
                  ? "Importing…"
                  : view.games.length
                    ? "Refresh from ESPN"
                    : "Import from ESPN"}
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
                  : "All final scores are entered. Finalize this week to reveal everyone's picks and update season standings."}{" "}
                Pulling results updates scores only; spreads stay as they were when the week opened.
              </Label>
              <Action
                disabled={!!busy || missing > 0 || view.games.length === 0}
                onPress={() =>
                  confirm(
                    "Finalize the week?",
                    "Everyone's picks and the winner will be revealed.",
                    "Finalize week",
                    () => {
                      void act("finalize", `/weeks/${weekId}/finalize`);
                    },
                  )
                }
              >
                {busy === "finalize" ? "Finalizing…" : "Finalize week"}
              </Action>
              <Action
                secondary
                disabled={!!busy}
                onPress={() =>
                  confirm(
                    "Pull results from ESPN?",
                    "Provider results replace any final scores entered by hand. Spreads stay fixed.",
                    "Pull results",
                    () => {
                      void act("results", `/weeks/${weekId}/results`);
                    },
                  )
                }
              >
                {busy === "results" ? "Pulling…" : "Pull results from ESPN"}
              </Action>
            </>
          )}
          {view.status === "final" && (
            <Label>
              Reopen to correct a score or spread. Picks are hidden again until you close it. Spreads stay as
              they were when the week opened unless you edit them by hand.
            </Label>
          )}
          {view.status === "final" && (
            <Action
              secondary
              disabled={!!busy}
              onPress={() =>
                confirm(
                  "Reopen this week?",
                  "Picks will be hidden again until the week is finalized.",
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
        {view.status === "open" && view.submissions && (
          <Card>
            <Eyebrow>Who has picked</Eyebrow>
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
              {view.submissions.map((entry) => (
                <View
                  role="row"
                  key={entry.userId}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}
                >
                  <View role="cell" style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Avatar name={entry.displayName} size={24} />
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
          </Card>
        )}
        <Failure message={week.error} retry={week.reload} />
        {view.status === "final" && view.results ? (
          <View onLayout={(event) => setResultsY(event.nativeEvent.layout.y)}>
            <WeekResults view={view} userId={me?.id} />
          </View>
        ) : (
          <>
            <Eyebrow>Games</Eyebrow>
            <Label>
              Spreads are the home team's line: −3.5 means the home team is favored by 3.5.
              {view.status === "open" && " A game with both scores entered is final and closed to picks."}
            </Label>
            <View role="table" aria-label="Games" style={{ gap: 16 }}>
              {view.games.map((game) => (
                <GameEditor
                  key={`${editorVersion}:${game.id}`}
                  game={game}
                  view={view}
                  disabled={!!busy}
                  onUpdated={week.setData}
                  onPending={(pending) => setBusy(pending ? `game:${game.id}` : undefined)}
                  onDraftChange={(draft) => draftChanged(game.id, draft)}
                />
              ))}
            </View>
            {view.games.length === 0 && <Label>No games yet. Import the schedule or add games below.</Label>}
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
        <View
          style={{
            backgroundColor: colors.chrome,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Action disabled={!!busy || !!problem} onPress={() => void saveAll()}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </Action>
            <Pill tone="warning">
              {changed.length} {changed.length === 1 ? "game" : "games"} changed
            </Pill>
          </View>
          {problem && <Failure message={problem} />}
        </View>
      )}
      {width < 768 && <LeagueTabBar leagueId={view.leagueId} active="league" />}
    </View>
  );
}

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
  onUpdated,
  onPending,
  onDraftChange,
}: {
  game: Game;
  onDraftChange: (draft: GameDraft | null) => void;
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
    setEdits((previous) => ({ ...previous, [field]: { value, base: base(field) } }));
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
  useEditsGuard(dirty && !busy, () => setEdits({}));
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
        <View style={s.row}>
          <View style={s.grow}>
            <Input
              label="Home spread"
              accessibilityLabel={`Home spread for ${name}`}
              value={shown("spread")}
              onChangeText={(value) => setField("spread", value)}
              keyboardType="numbers-and-punctuation"
              editable={!disabled && !busy}
            />
          </View>
          <View style={s.grow}>
            <Input
              label="Points"
              accessibilityLabel={`Points for ${name}`}
              value={shown("points")}
              onChangeText={(value) => setField("points", value)}
              keyboardType="number-pad"
              editable={!disabled && !busy}
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
                keyboardType="number-pad"
                editable={!disabled && !busy}
              />
            </View>
            <View style={s.grow}>
              <Input
                label={`${game.homeTeam} score`}
                accessibilityLabel={`${game.homeTeam} score in ${name}`}
                value={shown("homeScore")}
                onChangeText={(value) => setField("homeScore", value)}
                keyboardType="number-pad"
                editable={!disabled && !busy}
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
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel={`Use ${name} as the tiebreaker game`}
            accessibilityState={{ checked: view.tiebreakerGameId === game.id, disabled: disabled || busy }}
            aria-checked={view.tiebreakerGameId === game.id}
            disabled={disabled || busy}
            onPress={() => void update(`/weeks/${view.id}`, "PATCH", { tiebreakerGameId: game.id })}
            style={{ minHeight: 44, flexDirection: "row", gap: 10, alignItems: "center" }}
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
                <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: colors.primary }} />
              )}
            </View>
            <Text style={[s.text, { fontSize: 14 }]}>Tiebreaker game</Text>
          </Pressable>
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
  useEditsGuard(!!(homeTeam || awayTeam || kickoff || spread) && !busy, () => {
    setHome("");
    setAway("");
    setKickoff("");
    setSpread("");
  });
  async function add() {
    if (disabled || busy) return;
    const date = parseLeagueKickoff(kickoff, timeZone);
    if (!date) return setError("Enter a valid kickoff as YYYY-MM-DD HH:mm.");
    if (!spread.trim()) return setError("Enter the home spread.");
    const parsed = createGameSchema.safeParse({
      homeTeam,
      awayTeam,
      kickoff: date.toISOString(),
      spread: Number(spread),
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
      <Eyebrow>Add a game</Eyebrow>
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
      <Input
        // "Kickoff (Eastern time)": typed in the league's time zone.
        label={`Kickoff (${timeZones.find((zone) => zone.value === timeZone)?.label ?? timeZone} time)`}
        placeholder="YYYY-MM-DD HH:mm"
        value={kickoff}
        onChangeText={setKickoff}
        autoCapitalize="none"
        editable={!disabled && !busy}
      />
      <Input
        label="Home spread"
        value={spread}
        onChangeText={setSpread}
        keyboardType="numbers-and-punctuation"
        editable={!disabled && !busy}
      />
      <Failure message={error} />
      <Action
        secondary
        disabled={disabled || busy}
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
          style={{ gap: 8, borderRadius: 12, backgroundColor: `${colors.background}99`, padding: 12 }}
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
        disabled={busy || !title.trim() || !body.trim()}
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
