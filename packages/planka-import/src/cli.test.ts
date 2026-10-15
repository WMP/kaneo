import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { promptsMock } = vi.hoisted(() => ({ promptsMock: vi.fn() }));
vi.mock("prompts", () => ({ default: promptsMock }));

type Req = {
  method: string;
  path: string;
  search: string;
  body: unknown;
  headers: Headers;
};
type Handler = (req: Req) => unknown | Response;

const realFetch = globalThis.fetch;
const realArgv = process.argv;
const envKeys = ["PLANKA_API_KEY", "PLANKA_PASSWORD", "KANEO_API_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const outTtyDescriptor = Object.getOwnPropertyDescriptor(
  process.stdout,
  "isTTY",
);

let stdout = "";
let stderr = "";
let requests: Req[] = [];
let overrides: Record<string, Handler> = {};
let tmp = "";

const PLANKA = "https://planka.test";
const KANEO = "https://kaneo.test";

const board = { id: "b1", projectId: "pr1", name: "Main", position: 0 };
const user = {
  id: "u1",
  name: "Jane Doe",
  username: "jane",
  email: "jane@example.test",
};

function boardBundle(extra: Record<string, unknown> = {}) {
  return {
    item: board,
    included: {
      lists: [
        {
          id: "l1",
          boardId: "b1",
          name: "To Do",
          type: "active",
          position: 1,
          color: null,
        },
        {
          id: "l2",
          boardId: "b1",
          name: "Done",
          type: "closed",
          position: 2,
          color: null,
        },
        {
          id: "l3",
          boardId: "b1",
          name: "Old",
          type: "archive",
          position: 3,
          color: null,
        },
      ],
      cards: [
        {
          id: "c1",
          boardId: "b1",
          listId: "l1",
          name: "First card",
          description: "Desc",
          position: 1,
          dueDate: null,
          isDueCompleted: null,
          isClosed: null,
          commentsTotal: 1,
        },
      ],
      labels: [
        {
          id: "lb1",
          boardId: "b1",
          name: "Bug",
          color: "berry-red",
          position: 1,
        },
      ],
      cardLabels: [{ cardId: "c1", labelId: "lb1" }],
      cardMemberships: [{ cardId: "c1", userId: "u1" }],
      attachments: [{ id: "a1", cardId: "c1" }],
      users: [user],
      ...extra,
    },
  };
}

const defaults: Record<string, Handler> = {
  "POST /api/access-tokens": () => ({ item: "planka-jwt" }),
  "GET /api/projects": () => ({
    items: [{ id: "pr1", name: "Proj" }],
    included: { boards: [board] },
  }),
  "GET /api/boards/b1": () => boardBundle(),
  "GET /api/cards/c1/comments": (req) =>
    req.search
      ? { items: [] }
      : {
          items: [
            {
              id: "m1",
              cardId: "c1",
              userId: "u1",
              text: "Hello",
              createdAt: "2024-03-05T10:00:00.000Z",
            },
          ],
          included: { users: [user] },
        },
  "GET /api/auth/organization/list": () => [{ id: "ws1", name: "WS" }],
  "GET /api/project": () => [],
  "GET /api/workspace/ws1/members": () => [
    { id: "ku1", name: "Jane", email: "Jane@Example.test" },
  ],
  "POST /api/project": () => ({ id: "kp1", name: "Proj", slug: "PRO" }),
  "GET /api/column/kp1": () => [
    { id: "kc0", name: "Default", slug: "default" },
  ],
  "DELETE /api/column/kc0": () => ({}),
  "POST /api/column/kp1": () => ({ id: "kc1", name: "x", slug: "x" }),
  "POST /api/label": () => ({ id: "kl", name: "Bug", color: "#000000" }),
  "POST /api/task/kp1": () => ({ id: "kt1", title: "First card", number: 1 }),
  "POST /api/comment/kt1": () => ({}),
};

beforeEach(async () => {
  stdout = "";
  stderr = "";
  requests = [];
  overrides = {};
  tmp = await mkdtemp(join(tmpdir(), "planka-cli-"));
  promptsMock.mockReset();
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.exitCode = undefined;
  Object.defineProperty(process.stdin, "isTTY", {
    value: false,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: false,
    configurable: true,
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const req: Req = {
      method,
      path: parsed.pathname,
      search: parsed.search,
      body,
      headers: new Headers(init?.headers),
    };
    requests.push(req);
    const key = `${method} ${parsed.pathname}`;
    const handler = overrides[key] ?? defaults[key];
    if (!handler) return new Response(`unexpected ${key}`, { status: 599 });
    const result = handler(req);
    return result instanceof Response
      ? result
      : new Response(JSON.stringify(result));
  }) as unknown as typeof fetch;
});

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  process.argv = realArgv;
  process.exitCode = undefined;
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (ttyDescriptor)
    Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  if (outTtyDescriptor)
    Object.defineProperty(process.stdout, "isTTY", outTtyDescriptor);
  else delete (process.stdout as { isTTY?: boolean }).isTTY;
  await rm(tmp, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<number> {
  process.argv = ["node", "planka-import", ...args];
  process.exitCode = undefined;
  vi.resetModules();
  await import("./index.js");
  await vi.waitFor(() => expect(process.exitCode).toBeDefined());
  return process.exitCode as number;
}

const importArgs = [
  "--planka-url",
  PLANKA,
  "--planka-token",
  "tok",
  "--kaneo-url",
  KANEO,
  "--kaneo-api-key",
  "kk",
  "--workspace",
  "ws1",
  "--all",
  "--yes",
];

const kaneoWrites = () =>
  requests.filter(
    (r) =>
      ["POST", "DELETE"].includes(r.method) && r.path !== "/api/access-tokens",
  );

describe("help and version", () => {
  it("prints help and exits 0 without network access", async () => {
    expect(await run("--help")).toBe(0);
    expect(stdout).toContain(
      "kaneo-planka-import: migrate PLANKA boards into Kaneo",
    );
    expect(requests).toHaveLength(0);
  });

  it("prints the package version", async () => {
    expect(await run("-v")).toBe(0);
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, "../package.json"), "utf8"),
    ) as { version: string };
    expect(stdout).toBe(`${pkg.version}\n`);
  });

  it("reports argument errors on stderr with exit code 1", async () => {
    expect(await run("--bogus")).toBe(1);
    expect(stderr).toBe("Unknown option: --bogus\n");
  });
});

describe("authentication", () => {
  it("requires a PLANKA URL when it cannot prompt", async () => {
    expect(await run()).toBe(1);
    expect(stderr).toContain("--planka-url is required");
  });

  it("requires a user, then a password, when no token or key is given", async () => {
    expect(await run("--planka-url", PLANKA)).toBe(1);
    expect(stderr).toContain("--planka-user is required");

    stderr = "";
    expect(await run("--planka-url", PLANKA, "--planka-user", "jane")).toBe(1);
    expect(stderr).toContain("--planka-password is required");
    expect(requests).toHaveLength(0);
  });

  it("logs in with the password from the environment and then reads projects as a bearer", async () => {
    process.env.PLANKA_PASSWORD = "env-pw";
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-user",
        "jane",
        "--dry-run",
        "--all",
      ),
    ).toBe(0);
    expect(stdout).toContain("Authenticated with PLANKA");
    const login = requests[0];
    expect(login?.path).toBe("/api/access-tokens");
    expect(login?.body).toEqual({
      emailOrUsername: "jane",
      password: "env-pw",
    });
    const projects = requests.find((r) => r.path === "/api/projects");
    expect(projects?.headers.get("authorization")).toBe("Bearer planka-jwt");
  });

  it("uses PLANKA_API_KEY from the environment without logging in", async () => {
    process.env.PLANKA_API_KEY = "pk";
    expect(await run("--planka-url", PLANKA, "--dry-run", "--all")).toBe(0);
    expect(requests.some((r) => r.path === "/api/access-tokens")).toBe(false);
    expect(requests[0]?.headers.get("x-api-key")).toBe("pk");
  });

  it("surfaces a failed login as an error", async () => {
    overrides["POST /api/access-tokens"] = () =>
      new Response(JSON.stringify({ message: "bad" }), { status: 401 });
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-user",
        "j",
        "--planka-password",
        "x",
      ),
    ).toBe(1);
    expect(stderr).toContain("unauthorized (HTTP 401)");
  });
});

describe("dry run", () => {
  it("prints the plan, writes a report and never writes to Kaneo", async () => {
    const report = join(tmp, "report.json");
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "tok",
        "--dry-run",
        "--all",
        "--report",
        report,
      ),
    ).toBe(0);

    expect(stdout).toContain("Planned import:");
    expect(stdout).toContain(
      "• Proj  2 columns  1 tasks  1 labels  1 comments",
    );
    expect(stdout).toContain(
      "- skipping Old (archive/trash lists are not migrated)",
    );
    expect(stdout).toContain("- 1 attachment(s) will not be migrated");
    expect(stdout).toContain("Dry run. Nothing was written to Kaneo.");
    expect(stdout).toContain(`Report written to ${report}`);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    expect(requests.some((r) => r.path.startsWith("/api/auth"))).toBe(false);

    const saved = JSON.parse(await readFile(report, "utf8")) as Array<
      Record<string, unknown>
    >;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      project: "Proj",
      projectKey: "PROJ",
      columns: 2,
      tasks: 1,
      failed: false,
      skippedLists: ["Old"],
      skippedAttachments: 1,
    });
  });

  it("skips comment counts with --skip-comments and lists naming-conflict warnings", async () => {
    overrides["GET /api/boards/b1"] = () =>
      boardBundle({
        lists: [
          {
            id: "l1",
            boardId: "b1",
            name: "Done",
            type: "active",
            position: 1,
            color: null,
          },
          {
            id: "l2",
            boardId: "b1",
            name: "Done",
            type: "closed",
            position: 2,
            color: null,
          },
        ],
      });
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--dry-run",
        "--all",
        "--skip-comments",
      ),
    ).toBe(0);
    expect(stdout).toContain("0 comments");
    expect(stdout).toContain('! List "Done" was imported as column "Done 2"');
  });

  it("shows a board that cannot be read as failed in the plan", async () => {
    overrides["GET /api/boards/b1"] = () =>
      new Response(JSON.stringify({ message: "gone" }), { status: 404 });
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--dry-run",
        "--all",
      ),
    ).toBe(0);
    expect(stdout).toContain("✖ Proj: PLANKA /api/boards/b1: gone");
  });

  it("does not need a Kaneo key or workspace", async () => {
    expect(
      await run("--planka-url", PLANKA, "--planka-token", "t", "--dry-run"),
    ).toBe(0);
    expect(stderr).toBe("");
  });
});

describe("selection", () => {
  it("reports when the account has no boards", async () => {
    overrides["GET /api/projects"] = () => ({ items: [], included: {} });
    expect(await run("--planka-url", PLANKA, "--planka-token", "t")).toBe(0);
    expect(stdout).toContain("No boards found in PLANKA for this account.");
  });

  it("migrates every board when not interactive, even without --all", async () => {
    expect(
      await run("--planka-url", PLANKA, "--planka-token", "t", "--dry-run"),
    ).toBe(0);
    expect(stdout).toContain("• Proj");
  });

  it("filters by project name or id, case-insensitively", async () => {
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--dry-run",
        "--project",
        "PROJ",
      ),
    ).toBe(0);
    expect(stdout).toContain("• Proj");
    stdout = "";
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--dry-run",
        "--project",
        "PR1",
      ),
    ).toBe(0);
    expect(stdout).toContain("• Proj");
  });

  it("fails with the available project names when nothing matches", async () => {
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--dry-run",
        "--project",
        "nope",
      ),
    ).toBe(1);
    expect(stderr).toBe("No PLANKA project matched: nope. Available: Proj\n");
  });

  it("names multi-board projects as 'Project - Board'", async () => {
    overrides["GET /api/projects"] = () => ({
      items: [{ id: "pr1", name: "Proj" }],
      included: {
        boards: [
          board,
          { id: "b2", projectId: "pr1", name: "Other", position: 1 },
        ],
      },
    });
    overrides["GET /api/boards/b2"] = () => ({
      item: { id: "b2", projectId: "pr1", name: "Other", position: 1 },
      included: {},
    });
    expect(
      await run("--planka-url", PLANKA, "--planka-token", "t", "--dry-run"),
    ).toBe(0);
    expect(stdout).toContain("• Proj - Main");
    expect(stdout).toContain("• Proj - Other  0 columns  0 tasks");
  });
});

describe("import", () => {
  it("creates the project, columns, label, task and comment in Kaneo with the API key", async () => {
    const report = join(tmp, "out.json");
    expect(
      await run(...importArgs, "--icon", "Rocket", "--report", report),
    ).toBe(0);

    const out = kaneoWrites();
    expect(out.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/project",
      "DELETE /api/column/kc0",
      "POST /api/column/kp1",
      "POST /api/column/kp1",
      "POST /api/label",
      "POST /api/task/kp1",
      "POST /api/label",
      "POST /api/comment/kt1",
    ]);
    expect(out[0]?.body).toEqual({
      name: "Proj",
      workspaceId: "ws1",
      icon: "Rocket",
      slug: "PROJ",
    });
    expect(out[0]?.headers.get("authorization")).toBe("Bearer kk");
    expect(out[2]?.body).toEqual({ name: "To Do", isFinal: false });
    expect(out[3]?.body).toEqual({ name: "Done", isFinal: true });
    expect(out[5]?.body).toEqual({
      title: "First card",
      description: "Desc",
      status: "to-do",
      priority: "no-priority",
      userId: "ku1",
    });
    expect(out[7]?.body).toEqual({
      content: "Hello\n\n_Originally posted on 2024-03-05._",
      externalUserName: "Jane Doe",
      externalSource: "planka",
    });
    expect(stdout).toContain(
      "✔ Proj (PROJ)  2 columns  1 tasks  1 labels  1 comments  1 assignees",
    );
    expect(stdout).toContain("Finished. Everything imported.");

    const saved = JSON.parse(await readFile(report, "utf8")) as Array<
      Record<string, unknown>
    >;
    expect(saved[0]).toMatchObject({
      kaneoProjectId: "kp1",
      failed: false,
      comments: 1,
    });
  });

  it("takes the Kaneo API key from the environment and the default icon", async () => {
    process.env.KANEO_API_KEY = "env-key";
    const withoutKey = [...importArgs];
    withoutKey.splice(withoutKey.indexOf("--kaneo-api-key"), 2);
    expect(await run(...withoutKey)).toBe(0);
    const create = requests.find(
      (r) => r.method === "POST" && r.path === "/api/project",
    );
    expect(create?.headers.get("authorization")).toBe("Bearer env-key");
    expect(create?.body).toMatchObject({ icon: "Layout" });
  });

  it("warns when assignees have no email or are not workspace members", async () => {
    overrides["GET /api/boards/b1"] = () =>
      boardBundle({
        cards: [
          {
            id: "c1",
            boardId: "b1",
            listId: "l1",
            name: "A",
            description: null,
            position: 1,
            dueDate: null,
            isDueCompleted: null,
            isClosed: null,
            commentsTotal: 0,
          },
          {
            id: "c2",
            boardId: "b1",
            listId: "l1",
            name: "B",
            description: null,
            position: 2,
            dueDate: null,
            isDueCompleted: null,
            isClosed: null,
            commentsTotal: 0,
          },
        ],
        cardMemberships: [
          { cardId: "c1", userId: "u2" },
          { cardId: "c2", userId: "u3" },
        ],
        users: [
          { id: "u2", name: "No Mail", username: "nm" },
          {
            id: "u3",
            name: "Outsider",
            username: "o",
            email: "out@example.test",
          },
        ],
        cardLabels: [],
      });
    overrides["POST /api/task/kp1"] = () => ({
      id: "kt1",
      title: "t",
      number: 1,
    });
    const report = join(tmp, "warn.json");
    expect(await run(...importArgs, "--report", report)).toBe(0);
    const saved = JSON.parse(await readFile(report, "utf8")) as Array<{
      assignees: number;
      warnings: string[];
    }>;
    expect(saved[0]?.assignees).toBe(0);
    expect(saved[0]?.warnings).toEqual([
      expect.stringMatching(
        /^1 card assignment\(s\) were skipped because PLANKA did not return an email/,
      ),
      expect.stringMatching(
        /^1 card assignment\(s\) were skipped because no member of this Kaneo workspace/,
      ),
    ]);
    for (const task of requests.filter((r) => r.path === "/api/task/kp1")) {
      expect(task.body).not.toHaveProperty("userId");
    }
  });

  it("does not send comments with --skip-comments", async () => {
    expect(await run(...importArgs, "--skip-comments")).toBe(0);
    expect(requests.some((r) => r.path.startsWith("/api/comment"))).toBe(false);
    expect(requests.some((r) => r.path.startsWith("/api/cards"))).toBe(false);
  });

  it("requires a Kaneo API key for a real import and writes nothing", async () => {
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--workspace",
        "ws1",
        "--all",
      ),
    ).toBe(1);
    expect(stderr).toContain("A Kaneo API key is required.");
    expect(kaneoWrites()).toHaveLength(0);
  });

  it("exits 1 and reports the failure when a board cannot be created", async () => {
    overrides["POST /api/project"] = () =>
      new Response(JSON.stringify({ message: "slug taken" }), { status: 409 });
    expect(await run(...importArgs)).toBe(1);
    expect(stdout).toContain("✖ Proj: Kaneo /api/project: slug taken");
    expect(stdout).toContain("Finished with 1 failed board(s).");
    expect(requests.some((r) => r.path === "/api/task/kp1")).toBe(false);
  });

  it("shows import progress on a TTY and clears it before the summary", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    expect(await run(...importArgs)).toBe(0);
    expect(stdout).toContain('\r\u001B[2KCreating project "Proj" (PROJ)');
    expect(stdout).toContain('\r\u001B[2KImporting task 1/1 into "Proj"');
    expect(stdout).toContain("Finished. Everything imported.");
  });
});

describe("workspace selection", () => {
  const noWorkspace = importArgs.filter(
    (a, i, all) => a !== "--workspace" && all[i - 1] !== "--workspace",
  );

  it("uses the only workspace automatically", async () => {
    expect(await run(...noWorkspace)).toBe(0);
    expect(kaneoWrites()[0]?.body).toMatchObject({ workspaceId: "ws1" });
  });

  it("fails for an account without workspaces", async () => {
    overrides["GET /api/auth/organization/list"] = () => [];
    expect(await run(...noWorkspace)).toBe(1);
    expect(stderr).toContain("This Kaneo account has no workspaces.");
    expect(kaneoWrites()).toHaveLength(0);
  });

  it("asks for --workspace when several exist and it cannot prompt", async () => {
    overrides["GET /api/auth/organization/list"] = () => [
      { id: "ws1", name: "One" },
      { id: "ws2", name: "Two" },
    ];
    expect(await run(...noWorkspace)).toBe(1);
    expect(stderr).toContain(
      "pass --workspace with one of: One (ws1), Two (ws2)",
    );
  });

  it("prompts for the workspace when interactive", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    overrides["GET /api/auth/organization/list"] = () => [
      { id: "ws1", name: "One" },
      { id: "ws2", name: "Two" },
    ];
    overrides["GET /api/workspace/ws2/members"] = () => [];
    promptsMock.mockResolvedValueOnce({ value: "ws2" });
    expect(await run(...noWorkspace)).toBe(0);
    expect(promptsMock.mock.calls[0]?.[0]).toMatchObject({
      type: "select",
      choices: [
        { title: "One", value: "ws1" },
        { title: "Two", value: "ws2" },
      ],
    });
    expect(kaneoWrites()[0]?.body).toMatchObject({ workspaceId: "ws2" });
  });

  it("fails when the interactive workspace prompt is cancelled", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    overrides["GET /api/auth/organization/list"] = () => [
      { id: "ws1", name: "One" },
      { id: "ws2", name: "Two" },
    ];
    promptsMock.mockResolvedValueOnce({});
    expect(await run(...noWorkspace)).toBe(1);
    expect(stderr).toContain("No workspace selected.");
  });
});

describe("interactive prompts", () => {
  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  it("prompts for URL, credentials, boards and confirmation", async () => {
    promptsMock
      .mockResolvedValueOnce({ value: ` ${PLANKA} ` }) // url
      .mockResolvedValueOnce({ value: "jane" }) // user
      .mockResolvedValueOnce({ value: "secret" }) // password
      .mockImplementationOnce(
        async (q: { choices: Array<{ value: unknown }> }) => ({
          value: q.choices.map((c) => c.value),
        }),
      ) // boards
      .mockResolvedValueOnce({ value: true }); // confirm

    expect(
      await run(
        "--kaneo-url",
        KANEO,
        "--kaneo-api-key",
        "kk",
        "--workspace",
        "ws1",
      ),
    ).toBe(0);

    const questions = promptsMock.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(questions.map((q) => q.type)).toEqual([
      "text",
      "text",
      "password",
      "multiselect",
      "confirm",
    ]);
    expect(questions[3]?.choices).toMatchObject([
      { title: "Proj › Main", selected: true },
    ]);
    expect(questions[4]?.message).toBe(
      "Import 1 board(s) into Kaneo workspace ws1?",
    );
    expect(requests[0]?.body).toEqual({
      emailOrUsername: "jane",
      password: "secret",
    });
    expect(requests[0]?.path).toBe("/api/access-tokens");
    expect(stdout).toContain("Finished. Everything imported.");
  });

  it("aborts with exit code 1 and writes nothing when the user declines", async () => {
    promptsMock.mockResolvedValueOnce({ value: false });
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--all",
        "--kaneo-api-key",
        "kk",
        "--workspace",
        "ws1",
      ),
    ).toBe(1);
    expect(stdout).toContain("Aborted.");
    expect(kaneoWrites()).toHaveLength(0);
  });

  it("treats a missing confirm answer as a refusal", async () => {
    promptsMock.mockResolvedValueOnce({});
    expect(
      await run(
        "--planka-url",
        PLANKA,
        "--planka-token",
        "t",
        "--all",
        "--kaneo-api-key",
        "kk",
        "--workspace",
        "ws1",
      ),
    ).toBe(1);
    expect(stdout).toContain("Aborted.");
  });

  it("stops when no boards are selected", async () => {
    promptsMock.mockResolvedValueOnce({});
    expect(await run("--planka-url", PLANKA, "--planka-token", "t")).toBe(0);
    expect(stdout).toContain("Nothing selected.");
    expect(requests.some((r) => r.path.startsWith("/api/boards"))).toBe(false);
  });

  it("fails when a prompted URL comes back empty", async () => {
    promptsMock.mockResolvedValueOnce({ value: "   " });
    expect(await run()).toBe(1);
    expect(stderr).toContain("--planka-url is required");
  });
});
