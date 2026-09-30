import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJiraClient,
  JiraApiError,
} from "../../../apps/api/src/jira-integration/jira-client";

const TOKEN = "test-token-not-real-123";
const EMAIL = "someone@example.test";
const BASE = "https://jira.example.test";

const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  };
}

const originalPrivate = process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // The test host does not resolve; the destination check is exercised below.
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalPrivate === undefined) {
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  } else {
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = originalPrivate;
  }
});

describe("Jira client authentication", () => {
  it("sends a Bearer token for Server / Data Center", async () => {
    fetchMock.mockResolvedValue(reply({ name: "alice" }));
    const client = createJiraClient({
      baseUrl: BASE,
      deployment: "server",
      token: TOKEN,
      email: EMAIL,
    });

    await expect(client.myself()).resolves.toEqual({ name: "alice" });

    const call = lastCall();
    expect(call.url).toBe(`${BASE}/rest/api/2/myself`);
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.init.redirect).toBe("manual");
  });

  it("sends Basic base64(email:token) for Cloud", async () => {
    fetchMock.mockResolvedValue(reply({ accountId: "abc" }));
    const client = createJiraClient({
      baseUrl: BASE,
      deployment: "cloud",
      token: TOKEN,
      email: EMAIL,
    });

    await client.myself();

    expect(lastCall().headers.Authorization).toBe(
      `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`,
    );
  });

  it("refuses a Cloud call without an email and does not fetch", async () => {
    const client = createJiraClient({
      baseUrl: BASE,
      deployment: "cloud",
      token: TOKEN,
    });

    await expect(client.myself()).rejects.toBeInstanceOf(JiraApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Jira client requests", () => {
  const server = () =>
    createJiraClient({
      baseUrl: `${BASE}/jira/`,
      deployment: "server",
      token: TOKEN,
    });
  const cloud = () =>
    createJiraClient({
      baseUrl: BASE,
      deployment: "cloud",
      token: TOKEN,
      email: EMAIL,
    });

  it("keeps a context path and encodes path segments", async () => {
    fetchMock.mockResolvedValue(
      reply({ issueTypes: [{ id: "1", name: "Bug" }] }),
    );

    await expect(server().listIssueTypes("A B/C")).resolves.toEqual([
      { id: "1", name: "Bug" },
    ]);
    expect(lastCall().url).toBe(`${BASE}/jira/rest/api/2/project/A%20B%2FC`);
  });

  it("reads create fields from the new endpoint (Server shape: values)", async () => {
    fetchMock.mockResolvedValue(
      reply({
        values: [
          {
            fieldId: "summary",
            name: "Summary",
            required: true,
            schema: { type: "string", system: "summary" },
          },
          {
            fieldId: "customfield_1",
            name: "Team",
            required: false,
            hasDefaultValue: true,
            schema: { type: "option", custom: "x" },
            allowedValues: [{ id: "1", value: "A" }],
          },
        ],
        total: 2,
      }),
    );

    const fields = await server().getCreateFields("PRJ", "10001");

    expect(lastCall().url).toContain(
      "/rest/api/2/issue/createmeta/PRJ/issuetypes/10001?",
    );
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ fieldId: "summary", required: true });
    expect(fields[1]).toMatchObject({
      fieldId: "customfield_1",
      hasDefaultValue: true,
      allowedValues: [{ id: "1", value: "A" }],
    });
  });

  it("accepts the Cloud shape (fields) for create metadata", async () => {
    fetchMock.mockResolvedValue(
      reply({
        fields: [{ fieldId: "summary", name: "Summary", required: true }],
      }),
    );

    const fields = await cloud().getCreateFields("PRJ", "10001");

    expect(fields.map((field) => field.fieldId)).toEqual(["summary"]);
  });

  it("falls back to the legacy createmeta query on 404", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ errorMessages: ["Not Found"] }, 404))
      .mockResolvedValueOnce(
        reply({
          projects: [
            {
              issuetypes: [
                {
                  fields: {
                    summary: { name: "Summary", required: true },
                    labels: {
                      name: "Labels",
                      schema: { type: "array", items: "string" },
                    },
                  },
                },
              ],
            },
          ],
        }),
      );

    const fields = await server().getCreateFields("PRJ", "10001");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastCall().url).toBe(
      `${BASE}/jira/rest/api/2/issue/createmeta?projectKeys=PRJ&issuetypeIds=10001&expand=projects.issuetypes.fields`,
    );
    expect(fields.map((field) => field.fieldId)).toEqual(["summary", "labels"]);
    expect(fields[0]?.required).toBe(true);
  });

  it("does not fall back on other errors", async () => {
    fetchMock.mockResolvedValue(reply({ errorMessages: ["Boom"] }, 500));

    await expect(server().getCreateFields("PRJ", "1")).rejects.toMatchObject({
      status: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("searches users by username on Server and by query on Cloud", async () => {
    fetchMock.mockImplementation(async () => reply([]));

    await server().searchUsers("al ice");
    expect(lastCall().url).toBe(
      `${BASE}/jira/rest/api/2/user/search?username=al%20ice&maxResults=50`,
    );

    await cloud().searchUsers("al ice");
    expect(lastCall().url).toBe(
      `${BASE}/rest/api/2/user/search?query=al%20ice&maxResults=50`,
    );
  });

  it("prefers the assignable search when a project key is given", async () => {
    fetchMock.mockImplementation(async () => reply([]));

    await server().searchUsers("bob", "PRJ");
    expect(lastCall().url).toBe(
      `${BASE}/jira/rest/api/2/user/assignable/search?project=PRJ&username=bob&maxResults=50`,
    );

    await cloud().searchUsers("bob", "PRJ");
    expect(lastCall().url).toBe(
      `${BASE}/rest/api/2/user/assignable/search?project=PRJ&query=bob&maxResults=50`,
    );
  });

  it("lists statuses and components of a project", async () => {
    fetchMock.mockImplementation(async () => reply([]));

    await server().listStatuses("PRJ");
    expect(lastCall().url).toBe(`${BASE}/jira/rest/api/2/project/PRJ/statuses`);

    await server().listComponents("PRJ");
    expect(lastCall().url).toBe(
      `${BASE}/jira/rest/api/2/project/PRJ/components`,
    );
  });

  it("creates, updates and reads issues", async () => {
    fetchMock.mockResolvedValueOnce(reply({ id: "1", key: "PRJ-1" }, 201));
    await expect(
      server().createIssue({ summary: "Hello" }),
    ).resolves.toMatchObject({ key: "PRJ-1" });
    expect(lastCall()).toMatchObject({
      url: `${BASE}/jira/rest/api/2/issue`,
      body: { fields: { summary: "Hello" } },
    });
    expect(lastCall().init.method).toBe("POST");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      server().updateIssue("PRJ-1", { summary: "Bye" }),
    ).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe("PUT");
    expect(lastCall().url).toBe(`${BASE}/jira/rest/api/2/issue/PRJ-1`);

    fetchMock.mockResolvedValueOnce(reply({ id: "1", key: "PRJ-1" }));
    await server().getIssue("PRJ-1", ["status", "summary"]);
    expect(lastCall().url).toBe(
      `${BASE}/jira/rest/api/2/issue/PRJ-1?fields=status,summary`,
    );
  });

  it("searches issues with the search endpoint of the deployment", async () => {
    fetchMock.mockImplementation(async () =>
      reply({ issues: [{ id: "1", key: "PRJ-1" }] }),
    );

    await expect(
      server().searchIssues("key in (PRJ-1)", ["status"]),
    ).resolves.toHaveLength(1);
    expect(lastCall().url).toBe(`${BASE}/jira/rest/api/2/search`);
    expect(lastCall().body).toMatchObject({
      jql: "key in (PRJ-1)",
      fields: ["status"],
    });

    await cloud().searchIssues("key in (PRJ-1)", ["status"]);
    expect(lastCall().url).toBe(`${BASE}/rest/api/2/search/jql`);
  });
});

describe("Jira client errors", () => {
  const client = () =>
    createJiraClient({ baseUrl: BASE, deployment: "server", token: TOKEN });

  it("maps a Jira error body to status, errorMessages and errors", async () => {
    fetchMock.mockResolvedValue(
      reply(
        {
          errorMessages: ["Issue does not exist"],
          errors: { summary: "Summary is required" },
        },
        400,
      ),
    );

    const error = await client()
      .createIssue({})
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(JiraApiError);
    expect(error).toMatchObject({
      status: 400,
      kind: "HTTP_ERROR",
      errorMessages: ["Issue does not exist"],
      errors: { summary: "Summary is required" },
    });
    expect(error.message).toContain("400");
  });

  it("never puts the token, or its Basic form, into an error even if Jira echoes it", async () => {
    const basic = Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");
    fetchMock.mockImplementation(async () =>
      reply(
        {
          errorMessages: [`bad credentials ${TOKEN} and ${basic}`],
          errors: { field: `echo ${TOKEN}` },
        },
        401,
      ),
    );

    const cloud = createJiraClient({
      baseUrl: BASE,
      deployment: "cloud",
      token: TOKEN,
      email: EMAIL,
    });

    // The Basic form is only known to a Cloud client, which has the email.
    for (const [instance, secrets] of [
      [client(), [TOKEN]],
      [cloud, [TOKEN, basic]],
    ] as const) {
      const error = await instance.myself().catch((caught) => caught);
      const serialized = JSON.stringify({
        message: error.message,
        errorMessages: error.errorMessages,
        errors: error.errors,
        stack: error.stack,
      });
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret);
      }
      expect(error.errorMessages[0]).toContain("[redacted]");
    }
  });

  it("does not carry the network error or the token when fetch fails", async () => {
    fetchMock.mockRejectedValue(
      new Error(`connect ECONNREFUSED with header Bearer ${TOKEN}`),
    );

    const error = await client()
      .myself()
      .catch((caught) => caught);

    expect(error).toMatchObject({ status: 502, kind: "NETWORK" });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error.message)).not.toContain(TOKEN);
  });

  it("reports a redirect instead of following it", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://10.0.0.1/" },
      }),
    );

    await expect(client().myself()).rejects.toMatchObject({
      kind: "REDIRECT",
      status: 302,
    });
  });

  it("reports invalid JSON from a 200 and tolerates a non-JSON error page", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    await expect(client().myself()).rejects.toMatchObject({
      kind: "INVALID_JSON",
    });

    fetchMock.mockResolvedValueOnce(
      new Response("<html>bad gateway", { status: 502 }),
    );
    await expect(client().myself()).rejects.toMatchObject({
      kind: "HTTP_ERROR",
      status: 502,
      errorMessages: [],
    });
  });

  it("times out a request that never answers", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );

      const pending = client()
        .myself()
        .catch((caught) => caught);
      await vi.advanceTimersByTimeAsync(20_000);

      expect(await pending).toMatchObject({ kind: "TIMEOUT", status: 408 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Jira client destination rules", () => {
  it("refuses a private destination unless private destinations are allowed", async () => {
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    const client = createJiraClient({
      baseUrl: "https://127.0.0.1",
      deployment: "server",
      token: TOKEN,
    });

    await expect(client.myself()).rejects.toMatchObject({
      kind: "DESTINATION",
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses plain http unless private destinations are allowed", async () => {
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    const client = createJiraClient({
      baseUrl: "http://8.8.8.8",
      deployment: "server",
      token: TOKEN,
    });

    await expect(client.myself()).rejects.toMatchObject({
      kind: "DESTINATION",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows plain http on a private network when the deployment allows it", async () => {
    fetchMock.mockResolvedValue(reply({ name: "alice" }));
    const client = createJiraClient({
      baseUrl: "http://jira.internal.test:8080",
      deployment: "server",
      token: TOKEN,
    });

    await client.myself();

    expect(lastCall().url).toBe(
      "http://jira.internal.test:8080/rest/api/2/myself",
    );
  });
});
