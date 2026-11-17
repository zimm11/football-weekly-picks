// biome-ignore-all lint/correctness/noReactNativeRawText: Heading, Label and Action render native Text.
import {
  estimatedWeekStart,
  MAX_SURVIVOR_LIVES,
  REGULAR_SEASON_WEEKS,
  type SurvivorGameView,
  type SurvivorView,
  teamName,
  weekLabel,
} from "@picks/shared";
import { useState } from "react";
import { Text, View } from "react-native";
import { Menu, MenuItem, useAnchor } from "../../components/Popover";
import { request } from "../../lib/api";
import { now as clockNow } from "../../lib/clock";
import { notifyDone, notifyError } from "../../lib/notify";
import { currentWeek, survivorGameLocked, survivorMatchup, usedBy } from "../../lib/survivor";
import { kickoffDay, kickoffTime } from "../../lib/weekPresentation";
import type { AdminToolsProps } from "../leagueTypeScreens";
import {
  Action,
  Card,
  confirm,
  Failure,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Sheet,
  s,
  useEditsGuard,
} from "../leagueUi";
import { SurvivorSkeleton, useSurvivor } from "./useSurvivor";

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");

/**
 * Survivor's League-tab tools for admins: start the season (lives and start week, fixed once it kicks off), enter
 * a pick for a player, and correct the week's games (remove a cancelled one, correct a score). The weeks
 * themselves run from the feed.
 */
export function SurvivorAdminTools({ league, year, reload }: AdminToolsProps) {
  const survivor = useSurvivor(league.id, year);
  const view = survivor.data;
  if (!view) {
    return survivor.error ? (
      <Failure message={survivor.error} retry={survivor.reload} />
    ) : (
      <SurvivorSkeleton />
    );
  }
  const refresh = () => {
    survivor.reload();
    reload();
  };
  return (
    <>
      <PoolSettings
        key={`${year}:${view.settings?.lives}:${view.settings?.startWeek}`}
        view={view}
        year={year}
        onSaved={refresh}
      />
      {view.current && !view.over && <EnterPick view={view} onSaved={refresh} />}
      {view.weeks.some((w) => w.games.length > 0) && <WeekGames view={view} onSaved={refresh} />}
    </>
  );
}

function PoolSettings({ view, year, onSaved }: { view: SurvivorView; year: number; onSaved: () => void }) {
  const [lives, setLives] = useState(view.settings?.lives ?? 1);
  const [startWeek, setStartWeek] = useState(view.settings?.startWeek ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = lives !== (view.settings?.lives ?? 1) || startWeek !== (view.settings?.startWeek ?? 0);
  useEditsGuard(!!view.settings && dirty, () => {
    setLives(view.settings?.lives ?? 1);
    setStartWeek(view.settings?.startWeek ?? 0);
  });
  if (view.started) {
    return (
      <Card label="Survivor pool">
        <Heading>Survivor pool</Heading>
        <Label>
          {view.settings?.lives === 1 ? "One life" : `${view.settings?.lives} lives`}, from{" "}
          {weekLabel(view.settings?.startWeek ?? 1)}. They're fixed now that the start week has kicked off.
        </Label>
        {view.over && (
          <Label>This pool is over. Start next season's with New season… in the season menu.</Label>
        )}
      </Card>
    );
  }
  const at = clockNow();
  const weeks = Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1).filter(
    (n) => estimatedWeekStart(year, n) > at || n === view.settings?.startWeek,
  );
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await request(`/leagues/${view.leagueId}/seasons`, {
        method: "POST",
        body: { year, settings: { lives, ...(startWeek ? { startWeek } : {}) } },
      });
      notifyDone(view.settings ? "Pool settings saved." : `The ${year} pool has started.`);
      onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card label="Start season">
      <Heading>{view.settings ? "Survivor pool" : "Start season"}</Heading>
      <Label>
        {view.settings
          ? `Starts ${weekLabel(view.settings.startWeek ?? 1)}. You can change these until its first game kicks off.`
          : `Start the ${year} pool. Its first week is imported and opens by itself.`}
      </Label>
      <Select
        label="Lives"
        value={lives}
        disabled={busy}
        onChange={setLives}
        choices={Array.from({ length: MAX_SURVIVOR_LIVES }, (_, i) => ({
          value: i + 1,
          label: i === 0 ? "1: one loss and you're out" : `${i + 1}: out after ${i + 1} losses`,
        }))}
      />
      <Select
        label="Start week"
        value={startWeek}
        disabled={busy || weeks.length === 0}
        onChange={setStartWeek}
        choices={[
          ...(view.settings ? [] : [{ value: 0, label: "The next week" }]),
          ...weeks.map((n) => ({ value: n, label: weekLabel(n) })),
        ]}
      />
      <Failure message={error} />
      <Action disabled={busy || (!!view.settings && !dirty)} onPress={() => void save()}>
        {busy ? "Saving…" : view.settings ? "Save pool settings" : "Start season"}
      </Action>
    </Card>
  );
}

/** An admin enters (or changes) a pick for a player, under the same lock rules. */
function EnterPick({ view, onSaved }: { view: SurvivorView; onSaved: () => void }) {
  const week = currentWeek(view);
  const alive = view.players.filter((p) => p.alive && !p.removed);
  const [userId, setUserId] = useState(alive[0]?.userId ?? "");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEditsGuard(!!choice);
  if (!week || !alive.length) return null;
  const at = clockNow();
  const used = usedBy(view, userId, week.number);
  const teams = week.games
    .filter((g) => !survivorGameLocked(g, at))
    .flatMap((g) =>
      (["away", "home"] as const).map((side) => {
        const team = side === "home" ? g.homeTeam : g.awayTeam;
        return {
          value: `${g.id}:${side}`,
          label: `${teamName(team)} (${survivorMatchup(g)})${used.has(team) ? ", used" : ""}`,
        };
      }),
    );
  const player = alive.find((p) => p.userId === userId);
  async function save() {
    const [gameId, side] = choice.split(":");
    setBusy(true);
    setError(undefined);
    try {
      await request(`/weeks/${week?.id}/survivor-pick`, { method: "PUT", body: { gameId, side, userId } });
      setChoice("");
      notifyDone(`Pick saved for ${player?.displayName ?? "the player"}.`);
      onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card label="Enter a pick for a player">
      <Heading>Enter a pick for a player</Heading>
      <Label>
        For {weekLabel(week.number)}. It replaces any pick of theirs whose game hasn't kicked off, and they're
        told a commissioner entered it.
      </Label>
      <Select
        label="Player"
        value={userId}
        disabled={busy}
        onChange={(id) => {
          setUserId(id);
          setChoice("");
        }}
        choices={alive.map((p) => ({ value: p.userId, label: p.displayName }))}
      />
      <Select
        label="Team"
        value={choice}
        disabled={busy || teams.length === 0}
        onChange={setChoice}
        choices={[
          { value: "", label: teams.length ? "Choose a team" : "Every game has kicked off" },
          ...teams,
        ]}
      />
      <Failure message={error} />
      <Action disabled={busy || !choice} onPress={() => void save()}>
        {busy ? "Saving…" : `Save pick for ${player?.displayName ?? "player"}`}
      </Action>
    </Card>
  );
}

/** The week's games, each with a ⋯ menu: correct the score, or remove a cancelled game. */
function WeekGames({ view, onSaved }: { view: SurvivorView; onSaved: () => void }) {
  const withGames = view.weeks.filter((w) => w.games.length > 0);
  const [weekId, setWeekId] = useState(view.current?.weekId ?? withGames.at(-1)?.id ?? "");
  const [scoring, setScoring] = useState<SurvivorGameView | null>(null);
  const week = withGames.find((w) => w.id === weekId) ?? withGames.at(-1);
  if (!week) return null;
  async function remove(game: SurvivorGameView) {
    try {
      await request(`/survivor-games/${game.id}`, { method: "DELETE" });
      notifyDone(`${survivorMatchup(game)} was removed.`);
      onSaved();
    } catch (err) {
      notifyError(messageOf(err));
    }
  }
  return (
    <Card label="Week's games">
      <Heading>Games</Heading>
      <Label>
        Scores fill in from the feed and never replace one you type. Remove a game only if it's cancelled.
      </Label>
      {withGames.length > 1 && (
        <Select
          label="Week"
          value={week.id}
          onChange={setWeekId}
          choices={withGames.map((w) => ({ value: w.id, label: weekLabel(w.number) }))}
        />
      )}
      <View style={{ gap: 4 }}>
        {week.games.map((game) => (
          <GameRow
            key={game.id}
            game={game}
            timeZone={view.timeZone}
            final={week.status === "final"}
            onScore={() => setScoring(game)}
            onRemove={() =>
              confirm(
                `Remove ${survivorMatchup(game)}?`,
                "Picks on it are deleted, and those players can pick again.",
                "Remove game",
                () => void remove(game),
                true,
              )
            }
          />
        ))}
      </View>
      {scoring && (
        <ScoreSheet
          key={scoring.id}
          game={scoring}
          final={week.status === "final"}
          close={() => setScoring(null)}
          onSaved={onSaved}
        />
      )}
    </Card>
  );
}

function GameRow({
  game,
  timeZone,
  final,
  onScore,
  onRemove,
}: {
  game: SurvivorGameView;
  timeZone: string;
  final: boolean;
  onScore: () => void;
  onRemove: () => void;
}) {
  const options = useAnchor();
  const name = survivorMatchup(game);
  const scored = game.homeScore !== null && game.awayScore !== null;
  return (
    <View style={[s.divider, { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, { fontSize: 15 }]}>{name}</Text>
        <Text style={s.muted}>
          {scored
            ? `Final ${game.awayScore}–${game.homeScore}`
            : `${kickoffDay(game.kickoff, timeZone)} · ${kickoffTime(game.kickoff, timeZone)}`}
        </Text>
      </View>
      <IconButton name="more" label={`Options for ${name}`} ref={options.ref} onPress={options.open} />
      <Menu anchor={options.anchor} onClose={options.close} label={`Options for ${name}`} align="end">
        <MenuItem
          icon="pencil"
          label="Correct score"
          accessibilityLabel={`Correct the score of ${name}`}
          onPress={() => {
            options.close();
            onScore();
          }}
        />
        {!final && (
          <MenuItem
            icon="trash"
            destructive
            label="Remove game"
            accessibilityLabel={`Remove ${name}`}
            onPress={() => {
              options.close();
              onRemove();
            }}
          />
        )}
      </Menu>
    </View>
  );
}

function ScoreSheet({
  game,
  final,
  close,
  onSaved,
}: {
  game: SurvivorGameView;
  final: boolean;
  close: () => void;
  onSaved: () => void;
}) {
  const [away, setAway] = useState(game.awayScore === null ? "" : String(game.awayScore));
  const [home, setHome] = useState(game.homeScore === null ? "" : String(game.homeScore));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const valid = (v: string) => /^\d{1,3}$/.test(v);
  const clearing = !final && away === "" && home === "";
  useEditsGuard(
    away !== (game.awayScore === null ? "" : String(game.awayScore)) ||
      home !== (game.homeScore === null ? "" : String(game.homeScore)),
  );
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await request(`/survivor-games/${game.id}`, {
        method: "PATCH",
        body: clearing
          ? { homeScore: null, awayScore: null }
          : { homeScore: Number(home), awayScore: Number(away) },
      });
      notifyDone(`Score saved for ${survivorMatchup(game)}.`);
      close();
      onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Correct the score" close={close}>
      <Label>{survivorMatchup(game)}. Everyone's status is worked out again from it.</Label>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={s.grow}>
          <Input
            label={teamName(game.awayTeam)}
            value={away}
            onChangeText={setAway}
            keyboardType="number-pad"
            maxLength={3}
          />
        </View>
        <View style={s.grow}>
          <Input
            label={teamName(game.homeTeam)}
            value={home}
            onChangeText={setHome}
            keyboardType="number-pad"
            maxLength={3}
          />
        </View>
      </View>
      <Failure message={error} />
      <Action disabled={busy || !(clearing || (valid(away) && valid(home)))} onPress={() => void save()}>
        {busy ? "Saving…" : clearing ? "Clear the score" : "Save score"}
      </Action>
    </Sheet>
  );
}
