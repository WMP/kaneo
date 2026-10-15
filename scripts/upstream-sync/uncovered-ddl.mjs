#!/usr/bin/env node
// Prints the statements of a drizzle-kit generated migration that no given
// upstream migration already performs. Text based: it compares normalized
// statements, it does not understand SQL.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fail, isMain } from "./lib.mjs";

const HELP = `Usage: node scripts/upstream-sync/uncovered-ddl.mjs [options] <generated.sql> <upstream.sql...>

Prints the statements of <generated.sql> that none of the upstream migration
files performs, ready to paste into the migration (separated by
"--> statement-breakpoint"). Statements that cannot be checked are printed as
"-- VERIFY BY HAND" comments: ALTER TABLE ... ALTER COLUMN ... SET DEFAULT that
only an upstream DO $$ ... FOREACH/LOOP block could cover.

Normalization: comments, IF [NOT] EXISTS, the "public". qualifier, case,
whitespace and the trailing semicolon are ignored. A statement also counts as
covered when its text is part of an upstream DO $$ ... $$ block.

Options:
  --json        Print { uncovered, verifyByHand } as JSON
  -h, --help    Show this help

Exit codes: 0 report printed, 2 usage or read error.`;

const BREAKPOINT = /-->\s*statement-breakpoint/g;

/** Splits SQL on statement breakpoints and on semicolons outside $$ blocks. */
export function splitStatements(sql) {
  const statements = [];
  for (const rawChunk of sql.split(BREAKPOINT)) {
    // Full-line comments may contain semicolons; drop them before splitting.
    const chunk = rawChunk
      .split("\n")
      .filter((line) => !/^\s*--/.test(line))
      .join("\n");
    let current = "";
    let inDollar = false;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk.startsWith("$$", i)) {
        inDollar = !inDollar;
        current += "$$";
        i += 1;
        continue;
      }
      current += chunk[i];
      if (
        chunk[i] === ";" &&
        !inDollar &&
        (i + 1 === chunk.length || /\s/.test(chunk[i + 1]))
      ) {
        statements.push(current);
        current = "";
      }
    }
    statements.push(current);
  }
  return statements
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && statement !== ";");
}

export function normalize(statement) {
  return statement
    .replace(/--[^\n]*/g, " ")
    .replace(/\bIF NOT EXISTS\s+/gi, "")
    .replace(/\bIF EXISTS\s+/gi, "")
    .replace(/"public"\./gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*$/, "")
    .trim()
    .toLowerCase();
}

const SET_DEFAULT = /^alter table \S+ alter column \S+ set default /;

const isDoBlock = (normalized) => normalized.includes("$$");
const isLoopBlock = (normalized) =>
  isDoBlock(normalized) && /\b(foreach|loop)\b/.test(normalized);

/** Compares a generated migration with the upstream migrations. */
export function findUncovered(generatedSql, upstreamSqls) {
  const upstream = upstreamSqls.flatMap(splitStatements).map(normalize);
  const exact = new Set(upstream.filter((s) => !isDoBlock(s)));
  const blocks = upstream.filter(isDoBlock);
  const hasLoopBlock = blocks.some(isLoopBlock);

  const uncovered = [];
  const verifyByHand = [];
  for (const statement of splitStatements(generatedSql)) {
    const normalized = normalize(statement);
    if (
      exact.has(normalized) ||
      blocks.some((block) => block.includes(normalized))
    ) {
      continue;
    }
    if (hasLoopBlock && SET_DEFAULT.test(normalized)) {
      verifyByHand.push(statement);
    } else {
      uncovered.push(statement);
    }
  }
  return { uncovered, verifyByHand };
}

function terminated(statement) {
  return statement.endsWith(";") ? statement : `${statement};`;
}

export function render({ uncovered, verifyByHand }) {
  const lines = [
    uncovered.map(terminated).join("\n--> statement-breakpoint\n"),
  ];
  for (const statement of verifyByHand) {
    lines.push(
      `-- VERIFY BY HAND (an upstream DO $$ loop may set this default): ${statement.replace(/\s+/g, " ")}`,
    );
  }
  return lines.filter((line) => line.length > 0).join("\n");
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    fail(`${error.message}\n\n${HELP}`);
  }
  if (parsed.values.help) {
    console.log(HELP);
    return;
  }
  const [generated, ...upstreamFiles] = parsed.positionals;
  if (!generated || upstreamFiles.length === 0) {
    fail(
      `Give the generated SQL file and at least one upstream SQL file.\n\n${HELP}`,
    );
  }
  let result;
  try {
    result = findUncovered(
      readFileSync(generated, "utf8"),
      upstreamFiles.map((file) => readFileSync(file, "utf8")),
    );
  } catch (error) {
    fail(`Cannot read input: ${error.message}`);
  }
  if (parsed.values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const text = render(result);
    if (text) {
      console.log(text);
    }
    console.error(
      `${result.uncovered.length} uncovered statement(s), ${result.verifyByHand.length} to verify by hand.`,
    );
  }
}

if (isMain(import.meta.url)) {
  main();
}
