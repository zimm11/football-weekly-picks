import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

// AGENTS.md loads into every agent session, and Codex reads only the first 32 KiB of the instructions it
// finds (its `project_doc_max_bytes` default), dropping the rest without saying so. The file once grew past
// 100 KB that way. Detail about one area belongs in its doc under docs/agents/, which AGENTS.md routes to.
const MAX_BYTES = 24_000;

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const topicDocs = readdirSync(new URL("docs/agents/", root))
  .filter((file) => file.endsWith(".md"))
  .sort();
const docs = ["AGENTS.md", ...topicDocs.map((file) => `docs/agents/${file}`)];

/** Folders a path in the docs can start from, and build outputs that exist only after a build. */
const REPO_PATH = /^(apps|packages|scripts|e2e|supabase|docs|\.github)\//;
const BUILT = new Set(["apps/mobile/dist-web", "apps/api/dist"]);

test("AGENTS.md is small enough for every agent to read whole", () => {
  const size = statSync(new URL("AGENTS.md", root)).size;
  assert.ok(
    size <= MAX_BYTES,
    `AGENTS.md is ${size} bytes; keep it under ${MAX_BYTES} by moving detail into its area's doc in docs/agents/`,
  );
});

test("AGENTS.md routes to every doc in docs/agents, and to none that is missing", () => {
  const routed = [...read("AGENTS.md").matchAll(/`docs\/agents\/([\w-]+\.md)`/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(routed)].sort(), topicDocs);
});

test("every repo path the agent docs name exists", () => {
  for (const doc of docs) {
    for (const [, named] of read(doc).matchAll(/`([^`\s]+)`/g)) {
      const path = named.replace(/\/$/, "");
      // Globs and placeholders (`*.test.ts`, `<type>.ts`) name a pattern, not a file.
      if (!REPO_PATH.test(named) || /[*<>{}$]/.test(named) || BUILT.has(path)) continue;
      assert.ok(existsSync(new URL(path, root)), `${doc} names \`${named}\`, which doesn't exist`);
    }
  }
});
