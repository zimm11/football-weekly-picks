import type { FeedbackItem, OperatorOverview } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { OperatorDashboard } from "./OperatorDashboard";

const overview: OperatorOverview = {
  generatedAt: "2026-11-14T15:00:00.000Z",
  accounts: { total: 42, last7Days: 3, last30Days: 9 },
  leagues: { total: 6, last7Days: 1, last30Days: 2 },
  picks: { total: 1800, last7Days: 240, last30Days: 900 },
  messages: { total: 75, last7Days: 4, last30Days: 20 },
  activePlayers: { last7Days: 31, last30Days: 38 },
  activeLeagues: 5,
  openFeedback: 1,
  weeks: [
    { weekStart: "2026-11-09", signups: 3, leaguesCreated: 1, picks: 240, players: 31 },
    { weekStart: "2026-11-02", signups: 0, leaguesCreated: 0, picks: 250, players: 30 },
  ],
  recentLeagues: [
    { id: "l1", name: "Sunday Crew", createdAt: "2026-09-01T12:00:00.000Z", members: 12, lastPickAt: null },
  ],
  recentSignups: [
    {
      email: "pat@example.com",
      displayName: "Pat",
      createdAt: "2026-11-10T12:00:00.000Z",
      lastSignInAt: null,
      leagues: 2,
    },
  ],
};

const feedback: FeedbackItem[] = [
  {
    id: "f1",
    kind: "bug",
    message: "Standings are cut off",
    status: "open",
    page: "/leagues/abc/standings",
    userAgent: "TestBrowser/1",
    createdAt: "2026-11-13T12:00:00.000Z",
    author: { displayName: "Pat", email: "pat@example.com" },
  },
  {
    id: "f2",
    kind: "feature",
    message: "Add playoffs",
    status: "done",
    page: null,
    userAgent: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    author: null,
  },
];

describe("OperatorDashboard", () => {
  it("shows the totals with their recent growth", async () => {
    const screen = await render(
      <OperatorDashboard overview={overview} feedback={[]} onSetStatus={() => {}} />,
    );
    const totals = screen.getByRole("region", { name: "App totals" });
    await expect.element(totals.getByText("42", { exact: true })).toBeVisible();
    await expect.element(totals.getByText("+3 in 7 days · +9 in 30", { exact: true })).toBeVisible();
    await expect.element(totals.getByText("31", { exact: true })).toBeVisible();
    await expect
      .element(totals.getByText("Picked or posted in 7 days · 38 in 30", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("No open feedback.")).toBeVisible();
  });

  it("lists open feedback with its sender and page, and marks it done", async () => {
    const onSetStatus = vi.fn();
    const screen = await render(
      <OperatorDashboard overview={overview} feedback={feedback} onSetStatus={onSetStatus} />,
    );
    const open = screen.getByRole("list", { name: "Open feedback" });
    await expect.element(open.getByText("Standings are cut off")).toBeVisible();
    await expect.element(open.getByText(/sent from \/leagues\/abc\/standings/)).toBeVisible();
    await expect.element(open.getByRole("link", { name: "pat@example.com" })).toBeVisible();
    await expect.element(open.getByText("Add playoffs")).not.toBeInTheDocument();
    await open.getByRole("button", { name: "Mark done" }).click();
    expect(onSetStatus).toHaveBeenCalledWith("f1", "done");
  });

  it("keeps finished feedback folded away, where it can be reopened", async () => {
    const onSetStatus = vi.fn();
    const screen = await render(
      <OperatorDashboard overview={overview} feedback={feedback} onSetStatus={onSetStatus} />,
    );
    await screen.getByText("Done (1)").click();
    const done = screen.getByRole("list", { name: "Finished feedback" });
    await expect.element(done.getByText("Deleted account")).toBeVisible();
    await done.getByRole("button", { name: "Reopen" }).click();
    expect(onSetStatus).toHaveBeenCalledWith("f2", "open");
  });

  it("shows a report being saved as busy", async () => {
    const screen = await render(
      <OperatorDashboard overview={overview} feedback={feedback} savingId="f1" onSetStatus={() => {}} />,
    );
    await expect.element(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("lays out activity by week, newest leagues and newest accounts", async () => {
    const screen = await render(
      <OperatorDashboard overview={overview} feedback={[]} onSetStatus={() => {}} />,
    );
    const weeks = screen.getByRole("table", { name: "Activity by week" });
    await expect.element(weeks.getByRole("row").nth(1)).toHaveTextContent("Nov 93131240");
    await expect
      .element(screen.getByRole("table", { name: "Newest leagues" }).getByText("Sunday Crew"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("table", { name: "Newest accounts" }).getByText("Pat", { exact: true }))
      .toBeVisible();
  });
});
