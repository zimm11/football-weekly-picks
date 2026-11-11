import type { WeekSummary } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SeasonWeeks } from "./SeasonWeeks";

const week = (number: number): WeekSummary => ({
  id: `week-${number}`,
  number,
  year: 2026,
  status: "final",
  phase: "final",
  gameCount: 16,
  myPickCount: 16,
  availablePickCount: 0,
  myAvailablePickCount: 0,
  myMissingPickCount: 0,
});

describe("SeasonWeeks", () => {
  it("suggests the next week and submits the bounded selection and import preference", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <SeasonWeeks year={2026} weeks={[week(9)]} busy={false} onCreate={onCreate} />,
    );
    await expect.element(screen.getByRole("combobox", { name: "Week", exact: true })).toHaveValue("10");
    await screen.getByLabelText("Import games and spreads from ESPN").click();
    await screen.getByRole("button", { name: "Create week" }).click();
    expect(onCreate).toHaveBeenCalledWith(10, false);
  });

  it("opens existing weeks instead of offering duplicate creation", async () => {
    const screen = await render(
      <SeasonWeeks year={2026} weeks={[week(9)]} busy={false} onCreate={vi.fn()} />,
    );
    await screen.getByRole("combobox", { name: "Week", exact: true }).selectOptions("9");
    await expect
      .element(screen.getByRole("link", { name: "Manage week", exact: true }))
      .toHaveAttribute("href", "/weeks/week-9/manage");
    await expect.element(screen.getByRole("button", { name: "Create week" })).not.toBeInTheDocument();
  });

  it("shows season completion after week 18 rather than suggesting a duplicate", async () => {
    const weeks = Array.from({ length: 18 }, (_, index) => week(index + 1));
    const screen = await render(<SeasonWeeks year={2026} weeks={weeks} busy={false} onCreate={vi.fn()} />);
    await expect.element(screen.getByText(/Season complete/)).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Create week" })).not.toBeInTheDocument();
  });
});
