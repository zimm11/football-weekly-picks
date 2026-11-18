import type { ReportItem } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { groupReports, postActions, postPlaceholder, reportHeadline } from "./moderation";

const visible = { state: "visible" as const, mine: false, canAppeal: false };

describe("postActions", () => {
  it("lets anyone report and block someone else's message", () => {
    expect(postActions(visible, { canModerate: false, blockedAuthor: false })).toEqual(["report", "block"]);
    expect(postActions(visible, { canModerate: false, blockedAuthor: true })).toEqual(["report", "unblock"]);
  });

  it("gives admins remove, and restore once removed", () => {
    expect(postActions(visible, { canModerate: true, blockedAuthor: false })).toEqual([
      "report",
      "block",
      "remove",
    ]);
    expect(
      postActions({ ...visible, state: "removed" }, { canModerate: true, blockedAuthor: false }),
    ).toEqual(["block", "restore"]);
  });

  it("never offers reporting or blocking yourself; an author may appeal a removal once", () => {
    const mine = { ...visible, mine: true };
    expect(postActions(mine, { canModerate: false, blockedAuthor: false })).toEqual([]);
    expect(
      postActions(
        { ...mine, state: "removed", canAppeal: true },
        { canModerate: false, blockedAuthor: false },
      ),
    ).toEqual(["appeal"]);
    expect(
      postActions(
        { ...mine, state: "removed", canAppeal: false },
        { canModerate: false, blockedAuthor: false },
      ),
    ).toEqual([]);
  });
});

it("offers nothing on a message whose author deleted their account", () => {
  expect(
    postActions(
      { state: "deleted", mine: false, canAppeal: false },
      { canModerate: true, blockedAuthor: false },
    ),
  ).toEqual([]);
});

describe("postPlaceholder", () => {
  it("stands in for removed and hidden messages, and collapses a blocked player's until shown", () => {
    expect(postPlaceholder("removed", true)).toEqual({ text: "Message removed", canShow: false });
    expect(postPlaceholder("hidden", false)?.text).toBe("Hidden while it's reviewed");
    expect(postPlaceholder("blocked", false)).toEqual({
      text: "Message from a blocked player",
      canShow: true,
    });
    expect(postPlaceholder("blocked", true)).toBeNull();
    expect(postPlaceholder("visible", false)).toBeNull();
    expect(postPlaceholder("review", false)).toBeNull();
    expect(postPlaceholder("deleted", true)).toEqual({ text: "Deleted player's message", canShow: false });
    // An admin may show a hidden message to review it.
    expect(postPlaceholder("hidden", false, true)?.canShow).toBe(true);
    expect(postPlaceholder("hidden", true, true)).toBeNull();
  });
});

const report = (over: Partial<ReportItem> = {}): ReportItem => ({
  id: "r1",
  kind: "post",
  source: "player",
  reason: "spam",
  note: null,
  createdAt: "2026-11-01T12:00:00Z",
  league: { id: "l1", name: "Sunday Crew" },
  reporterName: "Sam",
  subject: { userId: "u1", displayName: "Riley Reader" },
  post: {
    id: "p1",
    threadId: "t1",
    threadTitle: "Week 9",
    position: 2,
    body: "Buy my picks",
    hidden: false,
    removed: false,
  },
  otherReports: 0,
  aboutAdmin: false,
  ...over,
});

describe("reportHeadline", () => {
  it("says what was reported and why", () => {
    expect(reportHeadline(report())).toBe("Message from Riley Reader: Spam");
    expect(reportHeadline(report({ kind: "display_name", post: null, reason: "harassment" }))).toMatch(
      /^Riley Reader's name: /,
    );
    expect(reportHeadline(report({ kind: "league_name", post: null, subject: null }))).toMatch(
      /^League name “Sunday Crew”: /,
    );
    expect(reportHeadline(report({ source: "recheck", reason: "flagged", reporterName: null }))).toBe(
      "Message from Riley Reader, flagged automatically",
    );
  });
  it("keeps a player's name as they wrote it in an appeal", () => {
    expect(reportHeadline(report({ source: "appeal", reason: "appeal" }))).toBe(
      "Appeal: message from Riley Reader",
    );
  });
});

describe("groupReports", () => {
  it("puts every report about one message on one card, in the queue's order", () => {
    const groups = groupReports([
      report({ id: "r1", otherReports: 2 }),
      report({ id: "r2", kind: "display_name", post: null, otherReports: 0 }),
      report({ id: "r3", reason: "harassment", reporterName: "Alex", otherReports: 2 }),
      report({ id: "r4", reason: "threat_self_harm", reporterName: "Pat", otherReports: 2 }),
    ]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([["r1", "r3", "r4"], ["r2"]]);
    expect(groups[0]).toMatchObject({ headline: "Message from Riley Reader: 3 reports", otherReports: 0 });
    expect(groups[0]?.first.id).toBe("r1");
    expect(groups[1]?.headline).toMatch(/^Riley Reader's name: /);
  });
  it("counts reports on the same message that the list doesn't hold", () => {
    expect(groupReports([report({ otherReports: 3 })])[0]?.otherReports).toBe(3);
    expect(
      groupReports([report({ id: "a", otherReports: 3 }), report({ id: "b", otherReports: 3 })])[0]
        ?.otherReports,
    ).toBe(2);
  });
  it("keeps an appeal apart from reports about the same message, and names apart per player", () => {
    const groups = groupReports([
      report({ id: "r1" }),
      report({ id: "r2", source: "appeal", reason: "appeal", reporterName: null }),
      report({ id: "r3", kind: "display_name", post: null }),
      report({ id: "r4", kind: "display_name", post: null, subject: { userId: "u2", displayName: "Pat" } }),
    ]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["r1"],
      ["r2"],
      ["r3"],
      ["r4"],
    ]);
  });
});
