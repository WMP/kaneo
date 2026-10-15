import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePackageEntryPath } from "./resolve-entry.js";

describe("resolvePackageEntryPath", () => {
  it("points at index.js one directory above the install module", () => {
    const entry = resolvePackageEntryPath();
    expect(path.isAbsolute(entry)).toBe(true);
    expect(path.basename(entry)).toBe("index.js");
    // src/install/resolve-entry.ts -> src/index.js (dist/install -> dist/index.js after build)
    expect(path.basename(path.dirname(entry))).toBe("src");
  });
});
