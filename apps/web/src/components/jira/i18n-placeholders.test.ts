import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import enUS from "@i18n/en-US.json";
import { describe, expect, it } from "vitest";

// The component tests mock `t` and interpolate whatever options they are given,
// so a call that passes `count` for a `{{total}}` string still passes there and
// renders a literal "{{total}}" for people. This test reads the Jira sources
// and checks every literal translation key against the shipped en-US copy.

const here = path.dirname(fileURLToPath(import.meta.url));

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const SOURCE_FILES = [
  ...listSourceFiles(here),
  path.resolve(here, "../project/jira-integration-settings.tsx"),
  path.resolve(here, "../../lib/jira-error.ts"),
];

type TranslationCall = {
  key: string;
  // `null` when there is no options argument; `undefined` when the options
  // argument is not an object literal (variable, spread, ...) and is skipped.
  suppliedKeys: Set<string> | null | undefined;
};

function skipWhitespace(source: string, from: number): number {
  let index = from;
  while (index < source.length && /\s/.test(source[index])) index++;
  return index;
}

// Returns the index just past the closing quote, or -1 for template literals
// with interpolation or unterminated strings.
function readStringEnd(source: string, start: number): number {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      index++;
    } else if (char === quote) {
      return index + 1;
    } else if (quote === "`" && char === "$" && source[index + 1] === "{") {
      return -1;
    }
  }
  return -1;
}

// Returns the index just past the bracket matching the one at `start`.
function readBalancedEnd(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = readStringEnd(source, index);
      if (end === -1) return -1;
      index = end - 1;
    } else if (char === "{" || char === "(" || char === "[") {
      depth++;
    } else if (char === "}" || char === ")" || char === "]") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

// Top-level property names of an object literal, or undefined when a spread or
// a computed key makes them unknowable.
function readObjectKeys(objectSource: string): Set<string> | undefined {
  const body = objectSource.slice(1, -1);
  const entries: string[] = [];
  let depth = 0;
  let entryStart = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = readStringEnd(body, index);
      if (end === -1) return undefined;
      index = end - 1;
    } else if (char === "{" || char === "(" || char === "[") {
      depth++;
    } else if (char === "}" || char === ")" || char === "]") {
      depth--;
    } else if (char === "," && depth === 0) {
      entries.push(body.slice(entryStart, index));
      entryStart = index + 1;
    }
  }
  entries.push(body.slice(entryStart));

  const keys = new Set<string>();
  for (const raw of entries) {
    const entry = raw.trim();
    if (entry === "") continue;
    if (entry.startsWith("...") || entry.startsWith("[")) return undefined;
    const match = entry.match(/^(?:["']([^"']+)["']|([\w$]+))\s*(?::|\(|$)/);
    if (!match) return undefined;
    keys.add(match[1] ?? match[2]);
  }
  return keys;
}

function findTranslationCalls(source: string): TranslationCall[] {
  const calls: TranslationCall[] = [];
  const callStart = /(?<![\w$.])(?:i18n\.)?t\(|(?<![\w$])i18n\.t\(/g;
  for (
    let match = callStart.exec(source);
    match !== null;
    match = callStart.exec(source)
  ) {
    const keyStart = skipWhitespace(source, match.index + match[0].length);
    if (!/["'`]/.test(source[keyStart] ?? "")) continue;
    const keyEnd = readStringEnd(source, keyStart);
    if (keyEnd === -1) continue;
    const key = source.slice(keyStart + 1, keyEnd - 1);

    const next = skipWhitespace(source, keyEnd);
    if (source[next] === ")") {
      calls.push({ key, suppliedKeys: null });
      continue;
    }
    if (source[next] !== ",") continue;
    const optionsStart = skipWhitespace(source, next + 1);
    if (source[optionsStart] === ")") {
      calls.push({ key, suppliedKeys: null });
    } else if (source[optionsStart] === "{") {
      const optionsEnd = readBalancedEnd(source, optionsStart);
      calls.push({
        key,
        suppliedKeys:
          optionsEnd === -1
            ? undefined
            : readObjectKeys(source.slice(optionsStart, optionsEnd)),
      });
    } else {
      calls.push({ key, suppliedKeys: undefined });
    }
  }
  return calls;
}

function lookup(key: string): string | undefined {
  const separator = key.indexOf(":");
  if (separator === -1) return undefined;
  const namespace = key.slice(0, separator);
  const value = key
    .slice(separator + 1)
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      (enUS as Record<string, unknown>)[namespace],
    );
  return typeof value === "string" ? value : undefined;
}

// The base key, else its i18next plural forms.
function resolveStrings(key: string): string[] {
  const base = lookup(key);
  if (base !== undefined) return [base];
  return [lookup(`${key}_one`), lookup(`${key}_other`)].filter(
    (value): value is string => value !== undefined,
  );
}

function extractPlaceholders(strings: string[]): Set<string> {
  const names = new Set<string>();
  for (const value of strings) {
    for (const match of value.matchAll(
      /\{\{-?\s*([\w$.]+)\s*(?:,[^}]*)?\}\}/g,
    )) {
      names.add(match[1]);
    }
  }
  return names;
}

function findProblems(file: string, source: string): string[] {
  const problems: string[] = [];
  for (const { key, suppliedKeys } of findTranslationCalls(source)) {
    const resolved = resolveStrings(key);
    if (resolved.length === 0) {
      problems.push(`${file}: key "${key}" does not exist in i18n/en-US.json`);
      continue;
    }
    if (suppliedKeys === undefined) continue;
    for (const name of extractPlaceholders(resolved)) {
      if (!suppliedKeys?.has(name)) {
        problems.push(
          `${file}: key "${key}" needs {{${name}}} but the call passes ${
            suppliedKeys === null
              ? "no options"
              : `{ ${[...suppliedKeys].join(", ")} }`
          }`,
        );
      }
    }
  }
  return problems;
}

describe("Jira translation calls", () => {
  it("supply every {{placeholder}} of the en-US string and use existing keys", () => {
    const problems = SOURCE_FILES.flatMap((file) =>
      findProblems(
        path.relative(path.resolve(here, "../../.."), file),
        readFileSync(file, "utf8"),
      ),
    );
    expect(problems).toEqual([]);
  });

  it("actually inspects the Jira sources", () => {
    const inspected = SOURCE_FILES.flatMap((file) =>
      findTranslationCalls(readFileSync(file, "utf8")),
    );
    expect(inspected.length).toBeGreaterThan(50);
    expect(
      inspected.some(
        ({ key, suppliedKeys }) =>
          key === "tasks:jira.panel.history.title" &&
          suppliedKeys?.has("total"),
      ),
    ).toBe(true);
  });

  describe("checker", () => {
    const file = "sample.tsx";

    it("reports a placeholder the options object does not supply", () => {
      const source = `t("tasks:jira.panel.history.title", { count: 3 })`;
      expect(findProblems(file, source)).toEqual([
        `${file}: key "tasks:jira.panel.history.title" needs {{total}} but the call passes { count }`,
      ]);
    });

    it("accepts shorthand keys and multi-line calls", () => {
      const source = `t(
        "tasks:jira.panel.history.title",
        {
          total,
        },
      )`;
      expect(findProblems(file, source)).toEqual([]);
    });

    it("fails a call without options for a string with placeholders", () => {
      expect(
        findProblems(file, `t("tasks:jira.panel.history.title")`),
      ).toHaveLength(1);
    });

    it("skips options that are not an object literal", () => {
      expect(
        findProblems(file, `t("tasks:jira.panel.history.title", opts)`),
      ).toEqual([]);
      expect(
        findProblems(file, `t("tasks:jira.panel.history.title", { ...opts })`),
      ).toEqual([]);
    });

    it("reports unknown keys", () => {
      expect(findProblems(file, `t("tasks:jira.panel.nope")`)).toHaveLength(1);
    });
  });
});
