// Writes docs/schema.md: a Mermaid ER diagram plus a table-by-table reference, generated from the Drizzle
// schema (src/schema.ts, the source of truth). Run with `pnpm db:erd`; `pnpm db:generate` runs it too, and CI
// fails if the committed file is out of date.
//
// Node runs schema.ts directly (built-in type stripping), so this needs no build step and no dependencies
// beyond drizzle-orm. Descriptions come from the `/** ... */` comments above tables and columns in schema.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

const schemaUrl = new URL("../src/schema.ts", import.meta.url);
const outputUrl = new URL("../../../docs/schema.md", import.meta.url);

const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const SHORT_TYPES = { "timestamp with time zone": "timestamptz", "double precision": "float8" };
const sqlType = (column) => SHORT_TYPES[column.getSQLType()] ?? column.getSQLType();

/** Collects doc comments from the schema source: `tables[exportName]` and `columns[exportName][key]`. */
function readComments(source) {
  const tables = {};
  const columns = {};
  let pending = null; // The doc comment waiting for the declaration below it.
  let open = null; // Lines of a multi-line comment still being read.
  let current = null; // The export whose columns we are inside.
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (open) {
      if (text.endsWith("*/")) {
        open.push(text.slice(0, -2));
        pending = open
          .map((l) => l.replace(/^\*\s?/, "").trim())
          .filter(Boolean)
          .join(" ");
        open = null;
      } else open.push(text);
      continue;
    }
    const oneLine = text.match(/^\/\*\*(.*)\*\/$/);
    if (oneLine) {
      pending = oneLine[1].trim();
      continue;
    }
    if (text.startsWith("/**")) {
      open = [text.slice(3)];
      continue;
    }
    const table = text.match(/^export const (\w+) = pgTable\(/);
    const column = text.match(/^(\w+): /);
    if (table) {
      current = table[1];
      columns[current] = {};
      if (pending) tables[current] = pending;
    } else if (column && current && pending) {
      columns[current][column[1]] = pending;
    }
    pending = null;
  }
  return { tables, columns };
}

const schema = await import(schemaUrl.href);
const comments = readComments(readFileSync(schemaUrl, "utf8"));

const tables = Object.entries(schema)
  .filter(([, value]) => value instanceof PgTable)
  .map(([exportName, table]) => {
    const config = getTableConfig(table);
    const keyOf = new Map(Object.entries(table).map(([key, column]) => [column, key]));
    const primary = new Set([
      ...config.columns.filter((c) => c.primary).map((c) => c.name),
      ...config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)),
    ]);
    const foreignKeys = config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      const target = getTableConfig(ref.foreignTable);
      return {
        columns: ref.columns.map((c) => snake(c.name)),
        nullable: ref.columns.some((c) => !c.notNull),
        table: target.schema ? `${target.schema}.${target.name}` : target.name,
        foreignColumns: ref.foreignColumns.map((c) => snake(c.name)),
      };
    });
    const uniques = [
      ...config.columns.filter((c) => c.isUnique).map((c) => [snake(c.name)]),
      ...config.uniqueConstraints.map((u) => u.columns.map((c) => snake(c.name))),
      ...config.indexes
        .filter((i) => i.config.unique && !i.config.where)
        .map((i) => i.config.columns.map((c) => snake(c.name))),
    ];
    // Unique indexes with a WHERE clause constrain only the rows that match it.
    const partialUniques = config.indexes
      .filter((i) => i.config.unique && i.config.where)
      .map((i) => ({ name: i.config.name, columns: i.config.columns.map((c) => snake(c.name)) }));
    return {
      name: config.name,
      description: comments.tables[exportName] ?? "",
      primary: [...primary].map(snake),
      foreignKeys,
      uniques,
      partialUniques,
      columns: config.columns.map((c) => ({
        name: snake(c.name),
        type: sqlType(c),
        nullable: !c.notNull,
        hasDefault: c.hasDefault,
        values: c.enumValues ?? null,
        description: comments.columns[exportName]?.[keyOf.get(c)] ?? "",
      })),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// ---------- Mermaid diagram ----------

const entityId = (name) => name.replace(".", "_");
const external = [...new Set(tables.flatMap((t) => t.foreignKeys.map((fk) => fk.table)))].filter(
  (name) => !tables.some((t) => t.name === name),
);

const diagram = ["erDiagram"];
for (const table of tables) {
  for (const fk of table.foreignKeys) {
    // One row per parent when the foreign key is also the whole primary key or unique on its own.
    const same = (cols) => cols.length === fk.columns.length && cols.every((c) => fk.columns.includes(c));
    const single = same(table.primary) || table.uniques.some(same);
    const parent = fk.nullable ? "|o" : "||";
    diagram.push(
      `  ${entityId(fk.table)} ${parent}--${single ? "o|" : "o{"} ${table.name} : "${fk.columns.join(", ")}"`,
    );
  }
}
for (const name of external) {
  diagram.push(`  ${entityId(name)}["${name} (Supabase Auth)"] {`, "    uuid id PK", "  }");
}
for (const table of tables) {
  diagram.push(`  ${table.name} {`);
  for (const column of table.columns) {
    const keys = [
      table.primary.includes(column.name) && "PK",
      table.foreignKeys.some((fk) => fk.columns.includes(column.name)) && "FK",
      table.uniques.some((u) => u.length === 1 && u[0] === column.name) && "UK",
    ].filter(Boolean);
    diagram.push(`    ${column.type} ${column.name}${keys.length ? ` ${keys.join(", ")}` : ""}`);
  }
  diagram.push("  }");
}

// ---------- Table reference ----------

const cell = (text) => text.replaceAll("|", "\\|");
const reference = [];
for (const table of tables) {
  reference.push(`### \`${table.name}\``, "");
  if (table.description) reference.push(table.description, "");
  reference.push("| Column | Type | Null | Key | Description |", "| --- | --- | --- | --- | --- |");
  for (const column of table.columns) {
    const fk = table.foreignKeys.find((f) => f.columns.includes(column.name));
    const keys = [
      table.primary.includes(column.name) && "PK",
      fk && `FK → \`${fk.table}.${fk.foreignColumns[fk.columns.indexOf(column.name)]}\``,
      table.uniques.some((u) => u.length === 1 && u[0] === column.name) && "unique",
    ].filter(Boolean);
    const notes = [
      column.description,
      column.values && `One of: ${column.values.map((v) => `\`${v}\``).join(", ")}.`,
      column.hasDefault && "Has a default.",
    ].filter(Boolean);
    reference.push(
      `| \`${column.name}\` | ${column.type} | ${column.nullable ? "yes" : "no"} | ${keys.join(", ")} | ${cell(notes.join(" "))} |`,
    );
  }
  const composite = table.uniques.filter((u) => u.length > 1);
  const list = (cols) => `(${cols.map((c) => `\`${c}\``).join(", ")})`;
  if (composite.length) reference.push("", `Unique together: ${composite.map(list).join("; ")}.`);
  for (const index of table.partialUniques) {
    reference.push(
      "",
      `Unique among rows matching a condition: ${list(index.columns)}, index \`${index.name}\` (the condition is in \`schema.ts\`).`,
    );
  }
  reference.push("");
}

const output = `# Database schema

<!-- Generated by \`pnpm db:erd\` from packages/db/src/schema.ts. Do not edit by hand: CI fails if it is out of date. -->

This file is generated from the Drizzle schema in \`packages/db/src/schema.ts\`, which is the source of truth.
To change the database, edit that file and run \`pnpm db:generate --name <desc>\`; it writes the migration and
refreshes this page. For an interactive view of a running database, open Supabase Studio (URL from
\`pnpm ports\`) and go to Database → Schema Visualizer.

Every table has row-level security enabled with no policies: only the API, which connects as a privileged
role, can read or write them.

## Diagram

\`\`\`mermaid
${diagram.join("\n")}
\`\`\`

Lines read parent to child and are labelled with the child's foreign-key column.

## Tables

${reference.join("\n").trimEnd()}
`;

writeFileSync(outputUrl, output);
console.log(`Wrote docs/schema.md (${tables.length} tables)`);
