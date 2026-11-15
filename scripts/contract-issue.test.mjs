import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMessage, failures, issueBody } from "./contract-issue.mjs";

const RUN = "https://github.com/owner/repo/actions/runs/1";

const report = {
  testResults: [
    {
      status: "failed",
      message: "",
      assertionResults: [
        {
          status: "passed",
          ancestorTitles: ["ESPN scoreboard"],
          title: "lists the slate",
          failureMessages: [],
        },
        {
          status: "failed",
          ancestorTitles: ["ESPN scoreboard"],
          title: "gives spreads as the home team's line",
          failureMessages: [
            "\u001b[31mError: Spreads the app reads wrongly:\n- PIT @ CIN: read 3.5, but the home team is favored\u001b[39m\n    at expectNone (/home/runner/work/x.ts:73:34)\n ❯ test/contract/espn.contract.ts:204:5",
          ],
        },
        {
          status: "skipped",
          ancestorTitles: ["ESPN game summary"],
          title: "has every section",
          failureMessages: [],
        },
      ],
    },
  ],
};

test("cleanMessage drops colors and stack frames", () => {
  assert.equal(
    cleanMessage(report.testResults[0].assertionResults[1].failureMessages[0]),
    "Error: Spreads the app reads wrongly:\n- PIT @ CIN: read 3.5, but the home team is favored",
  );
});

test("cleanMessage cuts a long message", () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const cleaned = cleanMessage(long).split("\n");
  assert.equal(cleaned.length, 41);
  assert.equal(cleaned.at(-1), "… 60 more lines");
});

test("failures lists only failed checks, by suite and title", () => {
  assert.deepEqual(
    failures(report).map((f) => f.name),
    ["ESPN scoreboard › gives spreads as the home team's line"],
  );
});

test("failures includes a file that failed before its tests ran", () => {
  const setup = {
    testResults: [
      { status: "failed", message: "Error: /scoreboard responded HTTP 404", assertionResults: [] },
    ],
  };
  assert.deepEqual(failures(setup), [
    { name: "Setup (finding the weeks to check)", message: "Error: /scoreboard responded HTTP 404" },
  ]);
});

test("issueBody names each failure and links the run", () => {
  const body = issueBody(report, RUN);
  assert.match(body, /\*\*1 failed check\*\*/);
  assert.match(body, /### ESPN scoreboard › gives spreads as the home team's line/);
  assert.match(body, /read 3\.5, but the home team is favored/);
  assert.ok(body.includes(`Run: ${RUN}`));
  assert.doesNotMatch(body, /\/home\/runner/);
});

test("issueBody still explains itself without a report", () => {
  assert.match(issueBody(null, RUN), /didn't produce a report/);
});

test("issueBody stays under GitHub's size limit", () => {
  const huge = {
    testResults: [
      {
        status: "failed",
        assertionResults: Array.from({ length: 40 }, (_, i) => ({
          status: "failed",
          ancestorTitles: ["ESPN"],
          title: `check ${i}`,
          failureMessages: [Array.from({ length: 40 }, () => "x".repeat(200)).join("\n")],
        })),
      },
    ],
  };
  const body = issueBody(huge, RUN);
  assert.ok(body.length < 65_536);
  assert.match(body, /more; see the run log/);
});
