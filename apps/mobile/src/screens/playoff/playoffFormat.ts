import { type LeagueDetail, WILD_CARD_ROUND } from "@picks/shared";

/** Whether a playoff season's format is fixed: once the Wild Card round is under way (the API holds to it too). */
export function playoffFormatLocked(weeks: LeagueDetail["weeks"]): boolean {
  const wildCard = weeks.find((w) => w.number === WILD_CARD_ROUND);
  return !!wildCard && wildCard.phase !== "draft" && wildCard.phase !== "accepting";
}
