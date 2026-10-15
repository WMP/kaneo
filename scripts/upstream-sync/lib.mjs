// Shared helpers for the upstream-sync scripts. Node built-ins only.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "../..");

/** True when the module is the entry point (not imported by a test). */
export function isMain(metaUrl) {
  return (
    process.argv[1] !== undefined &&
    metaUrl === pathToFileURL(resolve(process.argv[1])).href
  );
}

/** Runs git and returns stdout; throws on a non-zero exit. */
export function git(args, { cwd = process.cwd(), input } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Like git(), but returns null instead of throwing. */
export function gitOrNull(args, options) {
  try {
    return git(args, options);
  } catch {
    return null;
  }
}

/** Converts a glob to a RegExp. `**` crosses directories, `*` and `?` do not.
 * A pattern without a slash matches the base name at any depth (like gitignore). */
export function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${glob.includes("/") ? "" : "(?:.*/)?"}${source}$`);
}

/** Exit with a message and a code. */
export function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}
