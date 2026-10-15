import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDraftFields,
  type DraftTaskValues,
} from "../../../apps/api/src/jira-integration/draft";
import {
  describeJiraFailure,
  toJiraHttpError,
} from "../../../apps/api/src/jira-integration/errors";
import { convertFieldValue } from "../../../apps/api/src/jira-integration/field-values";
import {
  createJiraClient,
  JiraApiError,
} from "../../../apps/api/src/jira-integration/jira-client";
import { resolveJiraMapping } from "../../../apps/api/src/jira-integration/mapping";
import type { JiraMappingConfig } from "../../../apps/api/src/jira-integration/schema";

describe("convertFieldValue: scalar inputs for list types", () => {
  it("reads a number or a boolean as a single list item", () => {
    expect(convertFieldValue("options", 5, { deployment: "server" })).toEqual([
      { value: "5" },
    ]);
    expect(convertFieldValue("labels", true, { deployment: "server" })).toEqual(
      ["true"],
    );
    expect(
      convertFieldValue("components", 0, { deployment: "server" }),
    ).toEqual([{ name: "0" }]);
  });
});

describe("buildDraftFields: built-in sources", () => {
  const task: DraftTaskValues = {
    title: "T",
    description: null,
    priority: "high",
    status: "in-progress",
    dueDate: null,
    startDate: new Date("2026-09-15T00:00:00.000Z"),
    labels: [],
    progress: 40,
    assigneeUserId: null,
  };
  const config: JiraMappingConfig = {
    fieldMappings: [
      {
        target: { fieldId: "cf_status", type: "string" },
        source: { kind: "builtin", field: "status" },
      },
      {
        target: { fieldId: "cf_start", type: "date" },
        source: { kind: "builtin", field: "startDate" },
      },
      {
        target: { fieldId: "cf_due", type: "date" },
        source: { kind: "builtin", field: "dueDate" },
      },
      {
        target: { fieldId: "cf_progress", type: "number" },
        source: { kind: "builtin", field: "progress" },
      },
      {
        target: { fieldId: "cf_none", type: "string" },
        source: { kind: "none" },
      },
    ],
  };

  it("reads status, start date, progress and leaves an absent due date and a none source empty", () => {
    const { fields } = buildDraftFields({
      mapping: resolveJiraMapping({ workspace: config }),
      task,
      customValues: {},
      deployment: "server",
      assigneeIdentity: null,
    });
    const byId = (id: string) => fields.find((f) => f.fieldId === id);

    expect(byId("cf_status")).toMatchObject({
      value: "in-progress",
      jiraValue: "in-progress",
      origin: "task",
    });
    expect(byId("cf_start")).toMatchObject({
      value: "2026-09-15T00:00:00.000Z",
      jiraValue: "2026-09-15",
    });
    expect(byId("cf_progress")).toMatchObject({ value: 40, jiraValue: 40 });
    expect(byId("cf_due")).toMatchObject({
      value: null,
      jiraValue: null,
      origin: "empty",
    });
    expect(byId("cf_none")).toMatchObject({ value: null, origin: "empty" });
  });
});

describe("Jira error conversion", () => {
  it("rethrows an error that is not a Jira failure", () => {
    const boom = new Error("database down");
    expect(() => toJiraHttpError(boom)).toThrow(boom);
    expect(() => describeJiraFailure(boom)).toThrow(boom);
  });

  it("keeps an HTTPException as is and does not describe it as a Jira failure", () => {
    const refusal = new HTTPException(403, { message: "no" });
    expect(toJiraHttpError(refusal)).toBe(refusal);
    expect(() => describeJiraFailure(refusal)).toThrow(refusal);
  });

  it("describes a Jira API failure with its code and message", () => {
    const failure = describeJiraFailure(
      new JiraApiError("Jira request failed", 502, "NETWORK"),
    );
    expect(failure).toEqual({
      code: "JIRA_REQUEST_FAILED",
      message: "Jira request failed",
    });
    expect(
      describeJiraFailure(new JiraApiError("unauthorized", 401, "HTTP_ERROR"))
        .code,
    ).toBe("JIRA_TOKEN_INVALID");
  });
});

describe("Jira client response handling", () => {
  const fetchMock = vi.fn();
  const original = process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined)
      delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    else process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = original;
  });
  const client = () =>
    createJiraClient({
      baseUrl: "https://jira.example.test",
      deployment: "server",
      token: "tok-secret-1",
      email: "a@example.test",
    });

  it("lists projects and rejects an empty body as an EMPTY_RESPONSE failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ key: "KAN", name: "Kaneo" }]), {
        status: 200,
      }),
    );
    expect(await client().listProjects()).toEqual([
      { key: "KAN", name: "Kaneo" },
    ]);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client().listProjects()).rejects.toMatchObject({
      kind: "EMPTY_RESPONSE",
      status: 502,
    });
  });

  it("reads a top-level message from an error body and redacts the token in it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "bad tok-secret-1 here" }), {
        status: 400,
      }),
    );
    const error = await client()
      .myself()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JiraApiError);
    expect((error as JiraApiError).errorMessages).toEqual([
      "bad [redacted] here",
    ]);
    expect(JSON.stringify(error)).not.toContain("tok-secret-1");
  });
});
