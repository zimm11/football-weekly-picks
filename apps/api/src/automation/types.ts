import type { Db, leagues } from "@picks/db";
import type { RandomSource } from "@picks/shared";
import type { LeagueEventDeps } from "../leagueEvents";
import type { NflProvider } from "../nfl";
import type { ProviderWeeks } from "../weekOps";

/** A league as automation reads it. */
export type AutomatedLeague = typeof leagues.$inferSelect;

/** What one automation run has to work with. The same shape from the cron and from a player's read. */
export type AutomationContext = {
  db: Db;
  nfl: NflProvider;
  /** The run's clock: every step judges kickoffs and windows against it. */
  now: Date;
  /**
   * The provider's weeks, fetched at most once a minute per NFL week and shared by every league waiting on it, so
   * the feed is asked once per week per run however many leagues are due.
   */
  results: ProviderWeeks;
  /** How league events are delivered (`queueLeagueEvent`). Without email or push deps, that channel is skipped. */
  notify: LeagueEventDeps;
  requestId?: string;
  /** 32-bit random values for a squares board's draw at kickoff. Defaults to `crypto.getRandomValues`. */
  random?: RandomSource;
};

/** What advancing one league did: steps that changed something, and the notifications they queued. */
export type AdvanceResult = { steps: number; emails: number; pushes: number };
export const NOTHING_DONE: AdvanceResult = { steps: 0, emails: 0, pushes: 0 };

/**
 * One league type's automation. The steps are idempotent and each takes its week (or board) row lock, so the
 * cron and a player's read can run them at once, and running them twice leaves the same state. A step that
 * changes state queues its notifications (`queueLeagueEvent`) in the same transaction.
 */
export type LeagueTypeAutomation = {
  /**
   * The leagues of this type with something due at `ctx.now`, at most `limit`. Finished work must leave the due
   * set, so the rest follows on the next run.
   */
  due(ctx: AutomationContext, limit: number): Promise<AutomatedLeague[]>;
  /** Takes one league as far as it can go now: prepare, open, sync, finalize (a board: lock at kickoff, scores). */
  advance(ctx: AutomationContext, league: AutomatedLeague): Promise<AdvanceResult>;
};
