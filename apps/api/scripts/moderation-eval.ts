// Runs your own labeled messages through the screening model exactly as the app asks it (src/screening.ts) and
// reports the verdicts, to set or recheck the thresholds in packages/shared (`SCREENING_THRESHOLDS`).
//
//   MODERATION_EVAL_FILE=~/private/moderation-eval.jsonl CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
//     pnpm moderation:eval
//
// The labeled set lives outside this public repository: keep it on your own machine. Each line is
// {"kind": "reply", "text": "…", "expect": "allow"}, where `kind` is thread, reply, display_name or league_name and
// `expect` is allow or block. Include plenty of ordinary trash talk expected to be allowed: the run fails if any
// `allow` line is blocked. It also prints the range of block thresholds that would sort every line the way you
// labeled it, if there is one. Lines are never printed, only their line numbers and scores. Calls Workers AI, which
// costs a little: about 300 input tokens a line.
import { readFileSync } from "node:fs";
import { SCREENING_THRESHOLDS, type ScreeningVerdict, screeningVerdict } from "@picks/shared";
import { parseScreening, SCREENING_MODEL, type ScreenKind, screeningRequest } from "../src/screening";

type Line = { kind: ScreenKind; text: string; expect?: ScreeningVerdict };

function read(file: string): Line[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Line);
}

async function run() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const file = process.env.MODERATION_EVAL_FILE;
  if (!account || !token || !file) {
    console.error(
      "Set MODERATION_EVAL_FILE (your labeled set, kept outside the repo), CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with Workers AI read).",
    );
    process.exit(1);
  }
  const tally = new Map<string, number>();
  let wrongBlocks = 0;
  // The highest block score among lines you'd allow, and the lowest among lines you'd block.
  let highestAllowed = 0;
  let lowestBlocked = 1;
  let unanswered = 0;
  for (const [i, line] of read(file).entries()) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${SCREENING_MODEL}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(screeningRequest({ kind: line.kind, text: line.text }, SCREENING_MODEL)),
      },
    );
    const json = (await response.json().catch(() => null)) as { result?: unknown } | null;
    const scores = parseScreening(json?.result);
    if (!scores) {
      unanswered++;
      continue;
    }
    const verdict = screeningVerdict(scores);
    const key = `expected ${line.expect ?? "?"} → ${verdict}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (line.expect === "allow") highestAllowed = Math.max(highestAllowed, scores.block);
    if (line.expect === "block") lowestBlocked = Math.min(lowestBlocked, scores.block);
    if (line.expect === "allow" && verdict === "block") wrongBlocks++;
    if (line.expect && verdict !== line.expect)
      console.log(
        `Line ${i + 1}: expected ${line.expect}, got ${verdict} (block ${scores.block.toFixed(2)})`,
      );
  }
  console.log(`Threshold: block ≥ ${SCREENING_THRESHOLDS.block}`);
  for (const [key, n] of [...tally].sort()) console.log(`  ${key}: ${n}`);
  if (unanswered) console.log(`  no usable answer: ${unanswered}`);
  console.log(
    `Highest block score on a line you'd allow: ${highestAllowed.toFixed(2)}; lowest on a line you'd block: ${lowestBlocked.toFixed(2)}.`,
  );
  console.log(
    highestAllowed < lowestBlocked
      ? `Any block threshold above ${highestAllowed.toFixed(2)} and up to ${lowestBlocked.toFixed(2)} sorts every line as labeled.`
      : "No single threshold sorts every line as labeled: reword the criteria in src/screening.ts, or relabel.",
  );
  if (wrongBlocks) {
    console.error(
      `${wrongBlocks} line(s) expected to be allowed were blocked. Raise the block threshold or reword the criteria.`,
    );
    process.exit(1);
  }
}

await run();
