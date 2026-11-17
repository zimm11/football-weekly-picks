import type { leagues } from "@picks/db";
import type { LeagueType } from "@picks/shared";
import type { Tx } from "./context";
import { playoffHooks } from "./playoff";
import { squaresHooks } from "./squares";
import { survivorHooks } from "./survivor";
import { weeklyHooks } from "./weekly";

/**
 * What a league type does when something shared happens to one of its leagues. The shared routes (leagues.ts)
 * call these, so a type adds behavior in its own module instead of editing them.
 */
export type LeagueTypeHooks = {
  /**
   * A player left or was removed, inside the membership change's transaction (the league row is locked) and after
   * their membership is marked removed. Squares gives back their squares on boards that haven't locked.
   */
  memberRemoved?(tx: Tx, input: { leagueId: string; userId: string; at: Date }): Promise<void>;
  /**
   * Start season (`POST /leagues/:id/seasons`), inside a transaction holding the league row lock. `settings` are
   * already parsed with the type's schema (`parseSeasonSettings`). A hook only writes rows (the season and its
   * settings, plus any empty week it needs) and never asks the feed: automation's prepare step imports a week
   * with no games on the next read or cron run, and the route advances the league right after commit. Refuse with
   * `fail(…)`. A type without the hook answers 409.
   */
  startSeason?(
    tx: Tx,
    input: {
      league: typeof leagues.$inferSelect;
      year: number;
      settings: unknown;
      at: Date;
      actorId: string;
    },
  ): Promise<void>;
};

export const TYPE_HOOKS: Record<LeagueType, LeagueTypeHooks> = {
  weekly: weeklyHooks,
  playoff: playoffHooks,
  squares: squaresHooks,
  survivor: survivorHooks,
};
