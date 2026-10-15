import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearCredentials,
  credentialsPath,
  loadCredentials,
  saveCredentials,
} from "./token-store.js";

const creds = {
  version: 1 as const,
  baseUrl: "https://api.example.com",
  clientId: "kaneo-mcp",
  accessToken: "token-abc",
};

let dir = "";
let savedXdg: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kaneo-mcp-store-"));
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  await rm(dir, { recursive: true, force: true });
});

describe("token store", () => {
  it("stores credentials under XDG_CONFIG_HOME/kaneo-mcp/credentials.json", () => {
    expect(credentialsPath()).toBe(
      path.join(dir, "kaneo-mcp", "credentials.json"),
    );
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is blank", () => {
    process.env.XDG_CONFIG_HOME = "   ";
    expect(credentialsPath()).toMatch(
      /\.config[\\/]kaneo-mcp[\\/]credentials\.json$/,
    );
  });

  it("round-trips credentials and restricts file and directory permissions", async () => {
    await saveCredentials(creds);
    await expect(loadCredentials()).resolves.toEqual(creds);
    const file = await readFile(credentialsPath(), "utf8");
    expect(JSON.parse(file)).toEqual(creds);
    expect(file.endsWith("\n")).toBe(true);
    expect((await stat(credentialsPath())).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(credentialsPath()))).mode & 0o777).toBe(
      0o700,
    );
  });

  it("returns null when no file exists", async () => {
    await expect(loadCredentials()).resolves.toBeNull();
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["null", "null"],
    ["wrong version", JSON.stringify({ ...creds, version: 2 })],
    ["missing token", JSON.stringify({ ...creds, accessToken: undefined })],
    ["non-string baseUrl", JSON.stringify({ ...creds, baseUrl: 5 })],
    ["non-string clientId", JSON.stringify({ ...creds, clientId: null })],
  ])("returns null for a malformed file (%s)", async (_name, content) => {
    await mkdir(path.dirname(credentialsPath()), { recursive: true });
    await writeFile(credentialsPath(), content);
    await expect(loadCredentials()).resolves.toBeNull();
  });

  it("clears stored credentials and tolerates a missing file", async () => {
    await saveCredentials(creds);
    await clearCredentials();
    await expect(loadCredentials()).resolves.toBeNull();
    await expect(clearCredentials()).resolves.toBeUndefined();
  });
});
