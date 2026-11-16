import { dueReminderDay } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { parseDedupeKey, reminderEmailKey, threadEmailKey } from "../src/outbox";
import { playersToRemind, reminderSlate } from "../src/reminderTargets";

const WEEK = "11111111-1111-4111-8111-111111111111";
const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";

let n = 0;
function game(kickoff: string, scores: { homeScore?: number | null; awayScore?: number | null } = {}) {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    weekId: WEEK,
    externalId: null,
    kickoff: new Date(kickoff),
    homeTeam: "BUF",
    awayTeam: "MIA",
    spread: -3,
    points: 1,
    homeScore: null,
    awayScore: null,
    ...scores,
  } as Parameters<typeof reminderSlate>[0][number];
}

describe("reminderSlate", () => {
  it("orders games by kickoff, whatever order the database returned them in", () => {
    const sun = game("2026-11-15T18:00:00Z");
    const thu = game("2026-11-13T01:15:00Z");
    const mon = game("2026-11-17T01:15:00Z");
    expect(reminderSlate([sun, mon, thu]).map((g) => g.id)).toEqual([thu.id, sun.id, mon.id]);
  });

  it("counts a game as final only once both scores are in", () => {
    const [none, half, both] = reminderSlate([
      game("2026-11-15T18:00:00Z"),
      game("2026-11-15T18:01:00Z", { homeScore: 7 }),
      game("2026-11-15T18:02:00Z", { homeScore: 7, awayScore: 3 }),
    ]);
    expect([none?.final, half?.final, both?.final]).toEqual([false, false, true]);
  });

  it("walks game days in kickoff order, so overlapping windows remind for the sooner day first", () => {
    // Thursday 7:30pm Eastern: Thursday night's 8:15 game and Friday's are both inside their windows.
    const now = new Date("2026-11-13T00:30:00Z");
    const thu = game("2026-11-13T01:15:00Z");
    const fri = game("2026-11-14T01:15:00Z");
    const due = dueReminderDay(reminderSlate([fri, thu]), "America/New_York", now);
    expect(due).toMatchObject({ date: "2026-11-12", games: [{ id: thu.id }] });
  });

  it("doesn't let a half-entered score lock a game that hasn't kicked off", () => {
    const now = new Date("2026-11-15T01:00:00Z"); // Saturday evening, for Sunday.
    const sun = game("2026-11-15T18:00:00Z", { homeScore: 0 });
    const due = dueReminderDay(reminderSlate([sun]), "America/New_York", now);
    expect(due?.games.map((g) => g.id)).toEqual([sun.id]);
  });
});

describe("playersToRemind", () => {
  const slate = reminderSlate([game("2026-11-15T18:00:00Z"), game("2026-11-15T21:25:00Z")]);
  const [early, late] = slate as [(typeof slate)[number], (typeof slate)[number]];

  it("lists each member's unpicked games and leaves out members who picked them all", () => {
    const players = playersToRemind(
      slate,
      [ALICE, BOB],
      [
        { userId: ALICE, gameId: early.id },
        { userId: BOB, gameId: early.id },
        { userId: BOB, gameId: late.id },
      ],
    );
    expect(players).toEqual([{ userId: ALICE, missing: [late] }]);
  });

  it("reminds a member with no picks of every game, once, and ignores others' picks", () => {
    const players = playersToRemind(slate, [ALICE, ALICE], [{ userId: BOB, gameId: early.id }]);
    expect(players).toEqual([{ userId: ALICE, missing: [early, late] }]);
  });
});

describe("email dedupe keys", () => {
  it("round-trip the thread or week an email is about", () => {
    expect(parseDedupeKey(threadEmailKey(WEEK, ALICE))).toEqual({
      kind: "new_thread",
      threadId: WEEK,
      userId: ALICE,
    });
    expect(parseDedupeKey(reminderEmailKey(WEEK, "2026-11-15", ALICE))).toEqual({
      kind: "pick_reminder",
      weekId: WEEK,
      date: "2026-11-15",
      userId: ALICE,
    });
  });

  it("refuse anything else, so the recheck skips it rather than querying with junk", () => {
    for (const key of [
      "",
      "thread:not-a-uuid:x",
      `thread:${WEEK}`,
      `reminder:${WEEK}:tomorrow:${ALICE}`,
      `reminder:${WEEK}:2026-11-15`,
      `other:${WEEK}:${ALICE}`,
    ])
      expect(parseDedupeKey(key)).toBeNull();
  });
});
