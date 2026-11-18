// biome-ignore-all lint/correctness/noReactNativeRawText: Label, Pill, Heading, Eyebrow and Action render native Text.
import {
  BOARD_SIZE,
  type BoardSquare,
  type BoardView,
  MAX_SQUARES_PER_PLAYER,
  SQUARE_PERIOD_LABEL,
  SQUARE_PERIODS,
  type SquarePeriod,
  type ThreadPage,
} from "@picks/shared";
import { router } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { HomeLink } from "../../components/NotFound";
import { Body, colors, fonts, Screen, Title } from "../../components/ui";
import { messageOf, request } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { setUnreadThreads, subscribeMessagesChanged, useUnreadThreads } from "../../lib/messageUnread";
import { notifyDone, notifyError } from "../../lib/notify";
import { usePageTitle } from "../../lib/pageTitle";
import { boardTitle, type GameDraft, gameFromDraft, withPending } from "../../lib/squaresBoard";
import { LeagueHeader, LeagueTabBar } from "../LeagueChrome";
import { LeagueTabScroll } from "../LeagueTabScroll";
import {
  Action,
  Card,
  confirm,
  Disclosure,
  Eyebrow,
  Failure,
  Heading,
  Input,
  Label,
  Pill,
  s,
  useEditsGuard,
  useLeagueLoad,
} from "../leagueUi";
import { BoardHeading, BoardPanel, SquareSheet, useBoard, useSquareChanges } from "./BoardPanel";
import { forgetBoard, leagueOfBoard } from "./boardChoice";
import { GameChooser } from "./GameChooser";
import { newGameDraft, parseLimit } from "./NewBoard";
import { BoardSkeleton, SquaresGrid } from "./SquaresGrid";

/**
 * The league's tabs on a board screen, with the Messages tab's unread count as the league's own screens show
 * it: the count the league screen last loaded when there is one, and this screen's own load otherwise (a board
 * opened straight from a link).
 */
function BoardTabBar({ leagueId, wide }: { leagueId: string; wide?: boolean }) {
  const known = useUnreadThreads(leagueId);
  const unread = useLeagueLoad(
    () => request<ThreadPage>(`/leagues/${leagueId}/messages?limit=1`),
    `${leagueId}:unread`,
    30_000,
  );
  useEffect(() => subscribeMessagesChanged(unread.reload), [unread.reload]);
  useEffect(() => {
    if (unread.data) setUnreadThreads(leagueId, unread.data.unreadCount);
  }, [unread.data, leagueId]);
  return (
    <LeagueTabBar
      wide={wide}
      leagueId={leagueId}
      type="squares"
      active="board"
      unreadCount={known ?? unread.data?.unreadCount ?? 0}
    />
  );
}

/** A board screen's frame: the league's header and tabs around the content, as the week screens have. */
function BoardFrame({
  view,
  reload,
  children,
}: {
  view: BoardView | undefined;
  /** Pull to refresh: the board's `refresh`, so the spinner stays until the board has reloaded. */
  reload: () => unknown;
  children: ReactNode;
}) {
  const wide = useWindowDimensions().width >= 768;
  return (
    <View style={s.page}>
      <LeagueTabScroll
        reload={reload}
        header={
          view && (
            <>
              <LeagueHeader leagueId={view.leagueId} leagueName={view.leagueName} />
              {wide && <BoardTabBar wide leagueId={view.leagueId} />}
            </>
          )
        }
      >
        {children}
      </LeagueTabScroll>
      {view && !wide && <BoardTabBar leagueId={view.leagueId} />}
    </View>
  );
}

/**
 * A board link that leads nowhere: the board was deleted, or it isn't in one of the player's leagues. The
 * not-found screen, with the way back to the board's league when this session has seen it.
 */
function BoardNotFound({ boardId }: { boardId: string }) {
  const leagueId = leagueOfBoard(boardId);
  return (
    <Screen>
      {/* An alert, as the app's not-found screen is, so a page that turns into this one is announced. */}
      <View accessibilityRole="alert" style={{ gap: 8 }}>
        <Title>Board not found</Title>
        <Body muted>It may have been deleted, or it isn’t in one of your leagues.</Body>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {leagueId && (
          <Action compact icon="grid" href={`/leagues/${leagueId}`} how="replace">
            Back to the league
          </Action>
        )}
        <HomeLink />
      </View>
    </Screen>
  );
}

/** `/boards/:id`: one squares board as every member sees it. */
export function BoardScreen({ boardId }: { boardId: string }) {
  const board = useBoard(boardId);
  const { me } = useAuth();
  const view = board.data;
  const gone = !view && board.status === 404;
  usePageTitle(
    view ? `${view.awayTeam} at ${view.homeTeam} · ${view.leagueName}` : gone ? "Board not found" : undefined,
  );
  if (gone) return <BoardNotFound boardId={boardId} />;
  return (
    <BoardFrame view={view} reload={board.refresh}>
      <BoardPanel
        boardId={boardId}
        board={board}
        userId={me?.id ?? ""}
        avatarId={me?.avatarId}
        displayName={me?.displayName ?? "You"}
        standalone
      />
    </BoardFrame>
  );
}

/** `/boards/:id/manage`: the admin's board screen: game, limit, guest squares, Lock and draw, score corrections. */
export function ManageBoardScreen({ boardId }: { boardId: string }) {
  const board = useBoard(boardId);
  const { me } = useAuth();
  const view = board.data;
  const gone = !view && board.status === 404;
  usePageTitle(
    view
      ? `Manage ${view.awayTeam} at ${view.homeTeam} · ${view.leagueName}`
      : gone
        ? "Board not found"
        : undefined,
  );
  if (gone) return <BoardNotFound boardId={boardId} />;
  // The form below is seeded from the board (the limit, the scores): it waits for this visit's own load rather
  // than start from a remembered copy that may be out of date. A failed reload still shows the remembered board.
  const settled = board.fresh || !!board.error;
  return (
    <BoardFrame view={view} reload={board.refresh}>
      {!view || !settled ? (
        !view && board.error ? (
          <Failure message={board.error} retry={board.reload} />
        ) : (
          <BoardSkeleton />
        )
      ) : view.role !== "admin" ? (
        <Card>
          <Heading>Board management</Heading>
          <Label>Only league commissioners can manage a board.</Label>
          <Action href={`/boards/${boardId}`} how="replace">
            Go to the board
          </Action>
        </Card>
      ) : (
        <ManageBoard view={view} userId={me?.id ?? ""} board={board} />
      )}
    </BoardFrame>
  );
}

function ManageBoard({
  view,
  userId,
  board,
}: {
  view: BoardView;
  userId: string;
  board: ReturnType<typeof useBoard>;
}) {
  const [busy, setBusy] = useState<string>();
  const [guest, setGuest] = useState("");
  const [limit, setLimit] = useState(String(view.maxPerPlayer));
  const [draft, setDraft] = useState<GameDraft>(newGameDraft);
  // The game editor as it opened: only a choice made in it since is unsaved work.
  const [pristine, setPristine] = useState(draft);
  const [editingGame, setEditingGame] = useState(false);
  const [sheet, setSheet] = useState<{ row: number; col: number } | null>(null);
  const changes = useSquareChanges(view.id, board.setData, board.reload);
  const open = view.phase === "open";
  const limitDirty = open && limit !== String(view.maxPerPlayer);
  // Neither the limit nor the game can change once the board is locked, so nothing typed there is left to save.
  const gameDirty = open && editingGame && JSON.stringify(draft) !== JSON.stringify(pristine);
  useEffect(() => {
    if (!open) setEditingGame(false);
  }, [open]);
  useEditsGuard(limitDirty || gameDirty, () => {
    setLimit(String(view.maxPerPlayer));
    setEditingGame(false);
  });
  const squares = withPending(view.squares, changes.pending);
  const openSquares = BOARD_SIZE * BOARD_SIZE - squares.length;

  async function run(action: string, task: () => Promise<BoardView>, success: string) {
    if (busy) return;
    setBusy(action);
    try {
      board.setData(await task());
      notifyDone(success);
    } catch (err) {
      notifyError(messageOf(err));
    } finally {
      setBusy(undefined);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy("delete");
    try {
      await request(`/boards/${view.id}`, { method: "DELETE" });
      notifyDone("Board deleted.");
      // Unsaved edits on a board that is gone have nothing to go back to.
      setLimit(String(view.maxPerPlayer));
      setEditingGame(false);
      forgetBoard(view.leagueId, view.id);
      // After the reset above has rendered, so the unsaved-work guard doesn't ask about a deleted board.
      setTimeout(() => router.replace(`/leagues/${view.leagueId}` as never), 0);
    } catch (err) {
      notifyError(messageOf(err));
      setBusy(undefined);
    }
  }
  function saveLimit() {
    if (!limitDirty) return;
    const value = parseLimit(limit);
    if (value === null) return notifyError(`Squares per player go from 1 to ${MAX_SQUARES_PER_PLAYER}.`);
    void run(
      "limit",
      () => request<BoardView>(`/boards/${view.id}`, { method: "PATCH", body: { maxPerPlayer: value } }),
      "Limit saved.",
    );
  }
  function saveGame() {
    const { game, error } = gameFromDraft(draft, view.timeZone);
    if (error) return notifyError(error);
    void run(
      "game",
      async () => {
        const next = await request<BoardView>(`/boards/${view.id}`, { method: "PATCH", body: { game } });
        setEditingGame(false);
        return next;
      },
      "Game changed.",
    );
  }
  function tap(row: number, col: number, square: BoardSquare | undefined) {
    if (open && !square) {
      const name = guest.trim();
      if (!name) {
        notifyError("Type the guest's name first, then tap their squares.");
        return;
      }
      changes.send({ row, col, claim: true, name, userId: null }, name);
      return;
    }
    setSheet({ row, col });
  }
  const shown = sheet ? squares.find((sq) => sq.row === sheet.row && sq.col === sheet.col) : undefined;
  return (
    <>
      <BoardHeading view={view} admin manage />
      {open && (
        <Card label="Lock and draw">
          <Heading>Lock and draw</Heading>
          <Label>
            {openSquares} of 100 squares are open. The board locks itself at kickoff if nobody locks it first.
          </Label>
          <Action
            disabled={!!busy && busy !== "lock"}
            busy={busy === "lock"}
            icon="lock"
            onPress={() =>
              confirm(
                "Lock the board and draw the numbers?",
                `${openSquares} ${openSquares === 1 ? "square is" : "squares are"} still open. Once the numbers are drawn, nobody can claim or give back a square.`,
                "Lock and draw",
                () =>
                  void run(
                    "lock",
                    () => request<BoardView>(`/boards/${view.id}/lock`, { method: "POST" }),
                    "The numbers are drawn.",
                  ),
              )
            }
          >
            {busy === "lock" ? "Drawing…" : "Lock and draw"}
          </Action>
        </Card>
      )}
      {open && (
        <Card label="Guest squares">
          <Heading>Guest squares</Heading>
          <Input
            label="Guest's name"
            value={guest}
            onChangeText={setGuest}
            maxLength={40}
            placeholder="Someone without an account"
          />
          <Label>
            Then tap open squares to claim them for this guest. Guest squares count against nobody's limit.
          </Label>
        </Card>
      )}
      <SquaresGrid view={view} squares={squares} userId={userId} onPress={tap} />
      {sheet && (
        <SquareSheet view={view} row={sheet.row} col={sheet.col} square={shown} close={() => setSheet(null)}>
          {open && shown && (
            <Action
              secondary
              danger
              icon="trash"
              onPress={() => {
                setSheet(null);
                changes.send({
                  row: shown.row,
                  col: shown.col,
                  claim: false,
                  name: shown.name,
                  userId: shown.userId,
                });
              }}
            >
              {`Give back ${shown.name}'s square`}
            </Action>
          )}
        </SquareSheet>
      )}
      <Card label="Squares per player">
        <Heading>Squares per player</Heading>
        {open ? (
          <>
            <Input
              label="Most squares per player"
              value={limit}
              onChangeText={setLimit}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={3}
              onSubmit={saveLimit}
            />
            <Label>{`It can be raised before the lock, never lowered (1 to ${MAX_SQUARES_PER_PLAYER}).`}</Label>
            <Action
              compact
              disabled={(!!busy && busy !== "limit") || !limitDirty}
              busy={busy === "limit"}
              onPress={saveLimit}
            >
              {busy === "limit" ? "Saving…" : "Save limit"}
            </Action>
          </>
        ) : (
          <Label>{`${view.maxPerPlayer} per player. The board is locked.`}</Label>
        )}
      </Card>
      {open && (
        <Card label="Game">
          <Heading>Game</Heading>
          <Text style={s.text}>{boardTitle(view, view.timeZone)}</Text>
          <Label>
            {view.externalId
              ? "From the schedule: scores fill in by themselves."
              : "Typed in: enter the scores below as the game goes."}
          </Label>
          {editingGame ? (
            <>
              <GameChooser
                leagueId={view.leagueId}
                timeZone={view.timeZone}
                draft={draft}
                onChange={setDraft}
                disabled={!!busy}
                onSubmit={saveGame}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Action
                  compact
                  disabled={!!busy && busy !== "game"}
                  busy={busy === "game"}
                  onPress={saveGame}
                >
                  {busy === "game" ? "Saving…" : "Save game"}
                </Action>
                <Action compact secondary onPress={() => setEditingGame(false)}>
                  Cancel
                </Action>
              </View>
            </>
          ) : (
            <Action
              compact
              secondary
              onPress={() => {
                const fresh = newGameDraft();
                setDraft(fresh);
                setPristine(fresh);
                setEditingGame(true);
              }}
            >
              Change game
            </Action>
          )}
        </Card>
      )}
      {view.drawnAt && <ScoreCorrections view={view} busy={busy} run={run} />}
      <Card label="Delete board">
        <Heading>Delete board</Heading>
        <Label>
          {squares.length
            ? `The board goes for everyone, with its ${squares.length} claimed ${squares.length === 1 ? "square" : "squares"}${view.drawnAt ? ", its numbers and its results" : ""}.`
            : "The board goes for everyone."}
        </Label>
        <Action
          secondary
          danger
          icon="trash"
          disabled={!!busy && busy !== "delete"}
          busy={busy === "delete"}
          onPress={() =>
            confirm(
              "Delete this board?",
              `${boardTitle(view, view.timeZone)} and everything on it will be gone for good.`,
              "Delete board",
              () => void remove(),
              true,
            )
          }
        >
          {busy === "delete" ? "Deleting…" : "Delete board"}
        </Action>
      </Card>
    </>
  );
}

function ScoreCorrections({
  view,
  busy,
  run,
}: {
  view: BoardView;
  busy?: string;
  run: (action: string, task: () => Promise<BoardView>, success: string) => Promise<void>;
}) {
  const saved = (period: SquarePeriod) => view.scores.find((sc) => sc.period === period);
  const initial = () =>
    Object.fromEntries(
      SQUARE_PERIODS.map((p) => [
        p,
        { home: String(saved(p)?.homeScore ?? ""), away: String(saved(p)?.awayScore ?? "") },
      ]),
    ) as Record<SquarePeriod, { home: string; away: string }>;
  const [typed, setTyped] = useState(initial);
  const dirty = SQUARE_PERIODS.some(
    (p) =>
      typed[p].home !== String(saved(p)?.homeScore ?? "") ||
      typed[p].away !== String(saved(p)?.awayScore ?? ""),
  );
  useEditsGuard(dirty, () => setTyped(initial()));
  const save = (period: SquarePeriod, body: { homeScore: number | null; awayScore: number | null }) =>
    run(
      `score:${period}`,
      async () => {
        const next = await request<BoardView>(`/boards/${view.id}/scores/${period}`, { method: "PUT", body });
        const row = next.scores.find((sc) => sc.period === period);
        setTyped((t) => ({
          ...t,
          [period]: { home: String(row?.homeScore ?? ""), away: String(row?.awayScore ?? "") },
        }));
        return next;
      },
      body.homeScore === null ? "Score cleared." : "Score saved.",
    );
  return (
    <Card label="Scores">
      <Heading>Scores</Heading>
      <Disclosure title="How scores work">
        <Label>
          Scores are the totals so far, overtime included in the final. A game from the schedule fills them in
          as each quarter ends. A score you type is never replaced by the schedule; clear it to let the
          schedule fill it again.
        </Label>
      </Disclosure>
      {SQUARE_PERIODS.map((period) => {
        const row = saved(period);
        const home = Number(typed[period].home);
        const away = Number(typed[period].away);
        const valid =
          /^\d{1,3}$/.test(typed[period].home) &&
          /^\d{1,3}$/.test(typed[period].away) &&
          home <= 200 &&
          away <= 200;
        // Enter in either box saves the quarter, as its Save button does.
        const submit = () => {
          if (valid && !busy) void save(period, { homeScore: home, awayScore: away });
        };
        return (
          <View
            key={period}
            style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Eyebrow>{SQUARE_PERIOD_LABEL[period]}</Eyebrow>
              {row && <Pill>{row.byAdmin ? "Typed by a commissioner" : "From the schedule"}</Pill>}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Input
                  label={`${view.awayTeam} ${SQUARE_PERIOD_LABEL[period]} score`}
                  value={typed[period].away}
                  onChangeText={(value) =>
                    setTyped((t) => ({ ...t, [period]: { ...t[period], away: value } }))
                  }
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={3}
                  onSubmit={submit}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label={`${view.homeTeam} ${SQUARE_PERIOD_LABEL[period]} score`}
                  value={typed[period].home}
                  onChangeText={(value) =>
                    setTyped((t) => ({ ...t, [period]: { ...t[period], home: value } }))
                  }
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={3}
                  onSubmit={submit}
                />
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Action
                compact
                label={`Save the ${SQUARE_PERIOD_LABEL[period]} score`}
                disabled={(!!busy && busy !== `score:${period}`) || !valid}
                busy={busy === `score:${period}`}
                onPress={submit}
              >
                {busy === `score:${period}` ? "Saving…" : "Save"}
              </Action>
              {row?.byAdmin && (
                <Action
                  compact
                  secondary
                  label={`Clear the ${SQUARE_PERIOD_LABEL[period]} score`}
                  disabled={!!busy}
                  onPress={() => void save(period, { homeScore: null, awayScore: null })}
                >
                  Clear
                </Action>
              )}
            </View>
          </View>
        );
      })}
      <Text style={[s.muted, { fontFamily: fonts.body }]}>
        Players get a notification when each result is in.
      </Text>
    </Card>
  );
}
