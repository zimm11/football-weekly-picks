#!/usr/bin/env node
// Writes the body of the GitHub issue the feed contract workflow opens when a check fails, from Vitest's JSON
// report: which checks failed and why, without stack traces. The messages describe ESPN's public feeds only.
//
//   node scripts/contract-issue.mjs <vitest-report.json> <run-url> > body.md
import { readFileSync } from "node:fs";

/** GitHub rejects issue bodies over 65,536 characters. */
const MAX_BODY = 60_000;
const MAX_LINES_PER_FAILURE = 40;

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal color codes start with ESC.
const ANSI = /\u001b\[[0-9;]*m/g;

/** A failure message without colors, stack frames or code frames, cut to a readable length. */
export function cleanMessage(message) {
  const lines = String(message)
    .replace(ANSI, "")
    .split("\n")
    .filter((line) => !/^\s+at /.test(line) && !/^\s*❯ /.test(line))
    .map((line) => line.trimEnd());
  while (lines.length && !lines.at(-1)) lines.pop();
  if (lines.length <= MAX_LINES_PER_FAILURE) return lines.join("\n");
  return [
    ...lines.slice(0, MAX_LINES_PER_FAILURE),
    `… ${lines.length - MAX_LINES_PER_FAILURE} more lines`,
  ].join("\n");
}

/** Each failed check as { name, message }, including a file that failed before its tests could run. */
export function failures(report) {
  const found = [];
  for (const file of report?.testResults ?? []) {
    if (file.status === "failed" && file.message) {
      found.push({ name: "Setup (finding the weeks to check)", message: cleanMessage(file.message) });
    }
    for (const test of file.assertionResults ?? []) {
      if (test.status !== "failed") continue;
      found.push({
        name: [...(test.ancestorTitles ?? []), test.title].join(" › "),
        message: cleanMessage(test.failureMessages?.join("\n") ?? ""),
      });
    }
  }
  return found;
}

/** The issue body in Markdown. `report` is the parsed Vitest JSON report, or null if there isn't one. */
export function issueBody(report, runUrl) {
  const intro = [
    "The scheduled check of the ESPN feeds found responses that no longer match what POW Pick'em reads.",
    "The app keeps running, but the parts named below may be empty or wrong for players until the parsing in",
    "`apps/api/src/nfl.ts` or `apps/api/src/insights.ts` is updated. Rerun locally with `pnpm test:contract`.",
    "",
    `Run: ${runUrl}`,
    "",
  ];
  const found = failures(report);
  if (found.length === 0) {
    return [
      ...intro,
      "The check didn't produce a report of failed checks (it may have failed before reaching ESPN). See the run log.",
      "",
    ].join("\n");
  }
  const sections = found.map(({ name, message }) => `### ${name}\n\n\`\`\`text\n${message}\n\`\`\`\n`);
  let body = [...intro, `**${found.length} failed ${found.length === 1 ? "check" : "checks"}**`, ""].join(
    "\n",
  );
  for (const [i, section] of sections.entries()) {
    if (body.length + section.length > MAX_BODY) {
      body += `\n… and ${sections.length - i} more; see the run log.\n`;
      break;
    }
    body += `\n${section}`;
  }
  return body;
}

if (import.meta.main) {
  const [reportPath, runUrl = "(run link unavailable)"] = process.argv.slice(2);
  let report = null;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    // No report: the body says so.
  }
  process.stdout.write(issueBody(report, runUrl));
}
