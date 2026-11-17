import { z } from "zod";

/*
 * Playoff pick'em: the weekly game over the four postseason rounds (weeks 19–22), with one champion after the
 * Super Bowl. Its rules go here as pure functions (roundPoints, guillotineStatus, playoffStandings), the way
 * rules.ts holds the weekly ones. Everything time-dependent takes `now`.
 */

export const PLAYOFF_FORMATS = ["traditional", "guillotine"] as const;
export type PlayoffFormat = (typeof PLAYOFF_FORMATS)[number];

/** A playoff season's settings (`seasons.settings`). The format can't change after the first Wild Card kickoff. */
export const playoffSettingsSchema = z.object({
  format: z.enum(PLAYOFF_FORMATS).default("traditional"),
});
export type PlayoffSettings = z.infer<typeof playoffSettingsSchema>;

/** Extra points for a winning POW, by format. Weekly pick'em's is `POW_BONUS` in rules.ts. */
export const PLAYOFF_POW_BONUS: Record<PlayoffFormat, number> = { traditional: 3, guillotine: 1 };
