import type { leagues } from "@picks/db";
import type { LeagueType } from "@picks/shared";
import type { Tx } from "./context";
import { playoffHooks } from "./playoff";
import { squaresHooks } from "./squares";
import { survivorHooks } from "./survivor";

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
   * An admin starts a season (`POST /leagues/:leagueId/seasons`), inside its transaction. `settings` is already
   * parsed with the type's schema. No feed call happens here: automation imports the first week afterwards.
   */
  startSeason?(
    tx: Tx,
    input: {
      league: typeof leagues.$inferSelect;
      year: number;
      settings: unknown /* already parsed */;
      at: Date;
      actorId: string;
    },
  ): Promise<void>;
};

export const TYPE_HOOKS: Record<LeagueType, LeagueTypeHooks> = {
  weekly: {},
  playoff: playoffHooks,
  squares: squaresHooks,
  survivor: survivorHooks,
};
