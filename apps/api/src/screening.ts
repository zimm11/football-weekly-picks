import { MESSAGE_BODY_MAX, type ScreeningScores, THREAD_TITLE_MAX } from "@picks/shared";
import { z } from "zod";
import { logError } from "./logging";

/*
 * Screening what players post with Cloudflare's Clef decision models on Workers AI. The model answers one
 * either-or question (allow or block) with a probability for each answer; the threshold that turns those into a
 * decision is in `packages/shared` (`screeningVerdict`). The policy is written in plain words below,
 * so the repository never needs a list of offensive terms.
 */

export type ScreenKind = "thread" | "reply" | "display_name" | "league_name";

export type ScreenInput = {
  kind: ScreenKind;
  text: string;
  /** Earlier messages in the thread (or its title), for meaning only. */
  context?: string[];
};

export type Screener = {
  /**
   * The model's probabilities, or null when it couldn't answer in time (callers then save the content as
   * `unchecked` for the scheduled recheck). `deep` uses the larger model, for reports.
   */
  screen(input: ScreenInput, options?: { deep?: boolean }): Promise<ScreeningScores | null>;
};

/** Fast enough to check every post; the larger model only runs on reports. */
export const SCREENING_MODEL = "@cf/cloudflare/clef-flash";
export const REPORT_MODEL = "@cf/cloudflare/clef";
/** A post waits at most this long for the model before it is saved unchecked. */
export const SCREENING_TIMEOUT_MS = 1500;
/*
 * The most text one check sends, since the model is paid per token. The API already refuses anything longer
 * (`MESSAGE_BODY_MAX` and friends in `packages/shared`); these also bound posts saved under an older, longer limit.
 * The longest text is a new thread: its title, a blank line, then its first message.
 */
export const MAX_SCREEN_TEXT = THREAD_TITLE_MAX + 2 + MESSAGE_BODY_MAX;
/** Context is for meaning only, so a little of each earlier message is enough. */
export const MAX_CONTEXT_ITEM = 500;
export const MAX_CONTEXT_ITEMS = 6;

const KIND_WORDS: Record<ScreenKind, string> = {
  thread: "a new thread (its title, then its first message)",
  reply: "a reply in a thread",
  display_name: "a player's display name",
  league_name: "a league's name",
};

/** The policy, in plain words. Changing it means running the evaluation again (`apps/api/scripts/moderation-eval.ts`). */
export const SCREENING_CRITERIA = {
  allow:
    "Fine to post: trash talk about football itself (teams, players, games, picks, results and standings), including teasing someone about their picks or their team, over-the-top figures of speech about the game, jokes, and mild, casual swearing that isn't aimed at anyone.",
  block:
    "Not fine to post: anything aimed at a person rather than at their picks or their team, such as attacks on their life, looks, intelligence, family or relationships, or on whether they belong in the league; slurs or hate speech against a group; extreme or graphic profanity, or a stream of it, even when it isn't aimed at anyone; sexual content; real threats of violence or encouragement of self-harm; someone's private personal information such as a home address; and spam, scams or ads.",
} as const;

/** The Workers AI input for one check. Exported for the evaluation script, so it asks exactly what the app asks. */
export function screeningRequest(input: ScreenInput, model: string) {
  return {
    model: model.split("/").at(-1),
    state: JSON.stringify({
      kind: input.kind,
      text: input.text.slice(0, MAX_SCREEN_TEXT),
      ...(input.context?.length && {
        context: input.context.slice(0, MAX_CONTEXT_ITEMS).map((c) => c.slice(0, MAX_CONTEXT_ITEM)),
      }),
    }),
    questions: {
      verdict: {
        type: "choice",
        instructions: `\`text\` is ${KIND_WORDS[input.kind]} on a private message board for friends in an NFL pick'em league. Trash talk about the game is normal there; personal attacks are not. \`context\`, if present, is earlier messages, for meaning only: judge \`text\` alone. Should \`text\` be published?`,
        criteria: SCREENING_CRITERIA,
      },
    },
  };
}

const answerSchema = z.object({
  answers: z.object({
    verdict: z.object({
      probabilities: z.object({
        allow: z.number().min(0).max(1).catch(0),
        block: z.number().min(0).max(1).catch(0),
      }),
    }),
  }),
});

/**
 * The probabilities from a Clef answer (`answers.verdict.probabilities`). Read leniently: a missing option counts
 * as 0, and anything that isn't a usable answer is null, which saves the post unchecked rather than failing it.
 */
export function parseScreening(response: unknown): ScreeningScores | null {
  const parsed = answerSchema.safeParse(response);
  if (!parsed.success) return null;
  const { allow, block } = parsed.data.answers.verdict.probabilities;
  return allow + block > 0 ? { allow, block } : null;
}

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

/** Screening on the Worker's `AI` binding. Never throws: a slow or failing model is a null answer. */
export function clefScreener(ai: AiBinding, timeoutMs = SCREENING_TIMEOUT_MS): Screener {
  return {
    async screen(input, options) {
      const model = options?.deep ? REPORT_MODEL : SCREENING_MODEL;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), options?.deep ? timeoutMs * 2 : timeoutMs);
        });
        const answer = await Promise.race([ai.run(model, screeningRequest(input, model)), timeout]);
        if (answer === null) {
          logError("moderation_screen", { code: "ETIMEDOUT" });
          return null;
        }
        const scores = parseScreening(answer);
        if (!scores) logError("moderation_screen", new Error("Screening answer was unusable"));
        return scores;
      } catch (error) {
        logError("moderation_screen", error);
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
