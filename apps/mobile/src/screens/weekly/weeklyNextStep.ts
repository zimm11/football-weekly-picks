import { type LeagueDetail, REGULAR_SEASON_WEEKS, weekLabel } from "@picks/shared";

/** What an automatic weekly season does next, from its weeks as they stand. Empty before Start season. */
export function automaticNextStep(weeks: LeagueDetail["weeks"]): string {
  if (weeks.length === 0) return "";
  const latest = weeks.reduce((a, b) => (b.number > a.number ? b : a));
  const draft = weeks.find((w) => w.status === "draft");
  const open = weeks.find((w) => w.status === "open");
  if (draft)
    return draft.gameCount
      ? `${weekLabel(draft.number)} opens by itself on Tuesday at 9 AM Eastern, once every game has a line.`
      : `${weekLabel(draft.number)} imports its games from ESPN as soon as they're listed.`;
  if (open)
    return `${weekLabel(open.number)} is open. Results fill in as games end, and it finalizes after the last one.`;
  return latest.number >= REGULAR_SEASON_WEEKS
    ? "The season is complete: all its weeks are final."
    : `${weekLabel(latest.number + 1)} is imported from ESPN once it's listed, then opens on its Tuesday.`;
}
