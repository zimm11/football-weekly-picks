/** What the live contract checks share: fetching politely, reading with the app's schemas, the weeks to check. */
import { seasonYear } from "@picks/shared";
import type { z } from "zod";
import { espnProvider, espnScoreboardUrl, type ProviderGame } from "../../src/nfl";

/** The real clock, not a fixed date: the point is what the feeds serve now. */
export const now = new Date();
/** Lines are usually posted a few days out; within this window, a game with no line at all is suspicious. */
export const LINES_POSTED_WITHIN_MS = 3 * 24 * 60 * 60_000;

/** Games yet to kick off within the window lines are posted in. */
export const kickingOffSoon = (games: ProviderGame[]) =>
  games.filter((g) => g.kickoff > now && g.kickoff.getTime() - now.getTime() < LINES_POSTED_WITHIN_MS);

// ---------- Fetching ----------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` that retries a dropped connection, a rate limit (429) or a 5xx a couple of times, so a passing
 * blip doesn't raise an alert. Any other 4xx, or the same failure three times running, is reported as it is.
 * Each try gets its own timeout.
 */
export const fetchWithRetry: typeof fetch = async (input, init) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt === 3) return res;
      await res.body?.cancel();
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await sleep(2_000 * attempt);
  }
};

export async function getJson(url: string): Promise<unknown> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname} responded HTTP ${res.status}`);
  return res.json();
}

// ---------- Reading ----------

/** Parses with one of the app's own schemas, failing with which part of the response stopped matching. */
export function expectShape<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(`${what} no longer matches what the app reads:\n${issues(parsed.error)}`);
  return parsed.data;
}

/** A schema failure, one line per distinct problem: the same one in every game is one line, not sixteen. */
function issues(error: z.ZodError): string {
  const counts = new Map<string, number>();
  for (const issue of error.issues) {
    const path = issue.path.map((key) => (typeof key === "number" ? "[*]" : `.${String(key)}`)).join("");
    const line = `${issue.message} at ${path.replace(/^\./, "") || "(top level)"}`;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts].map(([line, n]) => `- ${line}${n > 1 ? ` (${n}×)` : ""}`).join("\n");
}

/** Fails listing every problem found, one per line, so the alert says exactly what changed. */
export function expectNone(problems: string[], what: string) {
  if (problems.length > 0) throw new Error(`${what}:\n${problems.map((p) => `- ${p}`).join("\n")}`);
}

// ---------- Which weeks to check ----------

export type Week = {
  year: number;
  week: number;
  raw: unknown;
  games: ProviderGame[];
  /** The app couldn't parse it at all. The checks on `raw` say why. */
  unreadable: boolean;
};

export async function scoreboard(year: number, week: number): Promise<Week> {
  const raw = await getJson(espnScoreboardUrl(year, week));
  // The same parse `espnProvider` does, kept with the raw response for the checks that need more of it.
  const games = await espnProvider(async () => Response.json(raw))
    .getWeek(year, week)
    .catch(() => null);
  return { year, week, raw, games: games ?? [], unreadable: games === null };
}

/**
 * The first regular-season week, this season or next, with a game still to kick off (or the first the app
 * can't read). Null in the offseason.
 */
export async function findUpcomingWeek(): Promise<Week | null> {
  for (const year of [seasonYear(now), seasonYear(now) + 1]) {
    for (let week = 1; week <= 18; week++) {
      const found = await scoreboard(year, week);
      if (found.unreadable || found.games.some((g) => g.kickoff > now)) return found;
      // No games at all: this season's schedule isn't out yet.
      if (found.games.length === 0) break;
    }
  }
  return null;
}
