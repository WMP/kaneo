// A tiny in-memory stand-in for the Gitea REST API, installed with
// vi.stubGlobal("fetch", ...). Only HTTP is faked; Kaneo code runs for real.

export type FakeCall = {
  method: string;
  path: string; // path + query, without the /api/v1 prefix
  body: unknown;
  authorization: string | null;
};

type FakeLabel = { id: number; name: string; color: string };
type FakeIssue = { number: number; labels: FakeLabel[]; state: string };

export type Override = (call: FakeCall) => Response | undefined;

export function createFakeGitea(options?: {
  labels?: FakeLabel[];
  issues?: FakeIssue[];
  override?: Override;
}) {
  const calls: FakeCall[] = [];
  const labels: FakeLabel[] = [...(options?.labels ?? [])];
  const issues = new Map<number, FakeIssue>(
    (options?.issues ?? []).map((issue) => [issue.number, issue]),
  );
  let nextLabelId = 100 + labels.length;
  let nextIssueNumber = 500;
  const state = { override: options?.override };

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchImpl = async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = `${url.pathname.replace(/^.*\/api\/v1/, "")}${url.search}`;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const call: FakeCall = {
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: headers.get("authorization"),
    };
    calls.push(call);

    const overridden = state.override?.(call);
    if (overridden) return overridden;

    const route = (re: RegExp) => url.pathname.match(re);
    const base = "/api/v1/repos/[^/]+/[^/]+";

    if (method === "GET" && route(/\/api\/v1\/user$/)) {
      return json({ id: 1, login: "kaneo-bot" });
    }
    if (method === "GET" && route(new RegExp(`^${base}$`))) {
      return json({
        name: "repo",
        owner: { login: "owner" },
        html_url: "https://gitea.example/owner/repo",
        private: false,
        permissions: { admin: true, push: true, pull: true },
      });
    }
    if (method === "GET" && route(new RegExp(`^${base}/labels$`))) {
      return json(labels);
    }
    if (method === "POST" && route(new RegExp(`^${base}/labels$`))) {
      const body = call.body as { name: string; color: string };
      const created = { id: nextLabelId++, name: body.name, color: body.color };
      labels.push(created);
      return json(created, 201);
    }
    let m = route(new RegExp(`^${base}/issues/(\\d+)/labels$`));
    if (m && method === "POST") {
      const issue = issues.get(Number(m[1]));
      const ids = (call.body as { labels: number[] }).labels;
      if (issue) {
        for (const id of ids) {
          const label = labels.find((l) => l.id === id);
          if (label && !issue.labels.some((l) => l.id === id)) {
            issue.labels.push(label);
          }
        }
      }
      return json(issue?.labels ?? []);
    }
    m = route(new RegExp(`^${base}/issues/(\\d+)/labels/(\\d+)$`));
    if (m && method === "DELETE") {
      const issue = issues.get(Number(m[1]));
      if (issue) {
        issue.labels = issue.labels.filter((l) => l.id !== Number(m?.[2]));
      }
      return new Response(null, { status: 204 });
    }
    m = route(new RegExp(`^${base}/issues/(\\d+)/comments$`));
    if (m && method === "POST") {
      return json(
        {
          id: 900,
          body: (call.body as { body: string }).body,
          html_url: "https://gitea.example/c/900",
          created_at: "2026-01-01T00:00:00Z",
        },
        201,
      );
    }
    m = route(new RegExp(`^${base}/issues/(\\d+)$`));
    if (m && method === "GET") {
      const issue = issues.get(Number(m[1]));
      return issue ? json(issue) : json({ message: "not found" }, 404);
    }
    if (m && method === "PATCH") {
      const issue = issues.get(Number(m[1]));
      if (issue) {
        Object.assign(issue, call.body);
      }
      return json({
        number: Number(m[1]),
        title: "t",
        body: null,
        html_url: "u",
        state: "open",
        ...(call.body as object),
      });
    }
    if (method === "POST" && route(new RegExp(`^${base}/issues$`))) {
      const body = call.body as { title: string };
      const number = nextIssueNumber++;
      issues.set(number, { number, labels: [], state: "open" });
      return json(
        {
          id: number,
          number,
          title: body.title,
          body: null,
          html_url: `https://gitea.example/owner/repo/issues/${number}`,
          state: "open",
        },
        201,
      );
    }
    return json({ message: `unhandled ${method} ${path}` }, 500);
  };

  return {
    fetch: fetchImpl,
    calls,
    labels,
    issues,
    setOverride(override: Override | undefined) {
      state.override = override;
    },
    callsTo(method: string, pathPattern: RegExp) {
      return calls.filter(
        (call) => call.method === method && pathPattern.test(call.path),
      );
    },
  };
}
