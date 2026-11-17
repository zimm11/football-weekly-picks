import { describe, expect, it, vi } from "vitest";
import {
  clefScreener,
  parseScreening,
  REPORT_MODEL,
  SCREENING_CRITERIA,
  SCREENING_MODEL,
  screeningRequest,
} from "../src/screening";

/** A Clef answer in the System One shape Workers AI returns. */
const answer = (probabilities: Record<string, unknown>) => ({
  model: "clef-flash",
  answers: { verdict: { type: "choice", choice: "allow", confidence: 0.9, probabilities } },
  usage: { input_tokens: 300, output_tokens: 0 },
});

describe("parseScreening", () => {
  it("reads the two probabilities", () => {
    expect(parseScreening(answer({ allow: 0.9, block: 0.1 }))).toEqual({ allow: 0.9, block: 0.1 });
  });

  it("counts a missing or malformed option as 0", () => {
    expect(parseScreening(answer({ allow: 0.6, block: "x" }))).toEqual({ allow: 0.6, block: 0 });
  });

  it("is null for anything that isn't a usable answer", () => {
    expect(parseScreening(null)).toBeNull();
    expect(parseScreening({ answers: {} })).toBeNull();
    expect(parseScreening(answer({}))).toBeNull();
  });
});

describe("screeningRequest", () => {
  it("asks one allow-or-block question with the plain-words policy, judging the text alone", () => {
    const request = screeningRequest(
      { kind: "reply", text: "Nice pick", context: ["Week 9"] },
      SCREENING_MODEL,
    );
    expect(request.model).toBe("clef-flash");
    expect(JSON.parse(request.state)).toEqual({ kind: "reply", text: "Nice pick", context: ["Week 9"] });
    expect(request.questions.verdict).toMatchObject({ type: "choice", criteria: SCREENING_CRITERIA });
    expect(request.questions.verdict.instructions).toContain("judge `text` alone");
  });

  it("caps what it sends", () => {
    const request = screeningRequest({ kind: "reply", text: "a".repeat(10_000) }, SCREENING_MODEL);
    expect(JSON.parse(request.state).text).toHaveLength(6000);
  });
});

describe("clefScreener", () => {
  it("uses the fast model for posts and the larger one for reports", async () => {
    const run = vi.fn(async (_model: string, _input: Record<string, unknown>) =>
      answer({ allow: 1, block: 0 }),
    );
    const screener = clefScreener({ run });
    await screener.screen({ kind: "thread", text: "Week 9 picks" });
    await screener.screen({ kind: "reply", text: "Reported" }, { deep: true });
    expect(run.mock.calls.map(([model]) => model)).toEqual([SCREENING_MODEL, REPORT_MODEL]);
  });

  it("answers null, never throws, when the model fails or is slow", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = clefScreener({
      run: async () => {
        throw new Error("down");
      },
    });
    expect(await failing.screen({ kind: "reply", text: "hi" })).toBeNull();
    const slow = clefScreener({ run: () => new Promise(() => {}) }, 10);
    expect(await slow.screen({ kind: "reply", text: "hi" })).toBeNull();
    // Only fixed operation names and codes reach the log, never the text.
    expect(error.mock.calls.flat().join(" ")).not.toContain("hi");
    error.mockRestore();
  });
});
