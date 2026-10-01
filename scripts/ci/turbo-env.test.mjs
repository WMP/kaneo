import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
const turbo = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8"));

// Turbo runs tasks in strict env mode: a variable that is neither listed nor
// inferred is removed from the task environment, so `pnpm dev` would ignore it
// when exported in the shell (it would work only from an env file).
const patterns = turbo.globalPassThroughEnv.map(
  (entry) =>
    new RegExp(
      `^${entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    ),
);
const passedThrough = (name) => patterns.some((pattern) => pattern.test(name));

// Set by the platform or by tools, not Kaneo settings.
const ignored = new Set(["APPDATA", "NODE_ENV", "XDG_CONFIG_HOME"]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "dist"
        ? []
        : sourceFiles(path);
    }
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

function variablesRead(directory) {
  const names = new Set();
  const read =
    /process\.env\.([A-Z][A-Z0-9_]+)|process\.env\["([A-Z][A-Z0-9_]+)"\]|\benv\.([A-Z][A-Z0-9_]+)|\benv\("([A-Z][A-Z0-9_]+)"\)/g;
  for (const file of sourceFiles(directory)) {
    for (const match of readFileSync(file, "utf8").matchAll(read)) {
      names.add(match.slice(1).find(Boolean));
    }
  }
  return [...names].filter((name) => !ignored.has(name)).sort();
}

test("every setting the API and email package read reaches `pnpm dev`", () => {
  const names = [
    ...variablesRead(join(root, "apps", "api", "src")),
    ...variablesRead(join(root, "packages", "email", "src")),
  ];
  assert.ok(names.length > 30, "expected to find the API settings");
  assert.deepEqual(
    [...new Set(names)].filter((name) => !passedThrough(name)),
    [],
    "add these to globalPassThroughEnv in turbo.json (a pattern such as PREFIX_* is fine)",
  );
});

test("shell flags reach the API in `pnpm dev`", () => {
  for (const name of [
    "AUTH_SECRET",
    "DATABASE_URL",
    "DISABLE_GUEST_ACCESS",
    "DISABLE_REGISTRATION",
    "DISABLE_USER_DIRECTORY",
    "DISABLE_WORKSPACE_CREATION",
    "KANEO_API_URL",
    "KANEO_CLIENT_URL",
  ]) {
    assert.ok(passedThrough(name), `${name} is not passed through`);
  }
});

test("build-time settings stay part of the cache key", () => {
  // The web bundle bakes VITE_* in; turbo hashes them (inferred from Vite),
  // which only holds while they are not allowlisted as pass-through.
  assert.ok(!passedThrough("VITE_API_URL"));
  assert.ok(!passedThrough("SENTRY_AUTH_TOKEN"));
  assert.ok(!turbo.globalPassThroughEnv.includes("VITE_*"));
});
