import * as Sentry from "@sentry/node";
import { assertPublicDestination } from "../utils/assert-public-destination";
import { withoutOutboundTelemetry } from "../utils/sensitive-outbound";
import {
  assertJiraTransport,
  type JiraDeployment,
  normalizeJiraBaseUrl,
} from "./config";

export type JiraApiErrorKind =
  | "HTTP_ERROR"
  | "REDIRECT"
  | "INVALID_JSON"
  | "TIMEOUT"
  | "NETWORK"
  | "DESTINATION"
  | "EMPTY_RESPONSE";

// Carries what Jira said (`errorMessages`, `errors`) and never the credential.
export class JiraApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: JiraApiErrorKind,
    public errorMessages: string[] = [],
    public errors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export type JiraUser = {
  // Server / Data Center
  name?: string;
  key?: string;
  // Cloud
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
};

export type JiraProject = {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
};

export type JiraIssueType = {
  id: string;
  name: string;
  description?: string;
  subtask?: boolean;
};

export type JiraFieldSchema = {
  type: string;
  items?: string;
  system?: string;
  custom?: string;
  customId?: number;
};

export type JiraAllowedValue = {
  id?: string;
  name?: string;
  value?: string;
  [key: string]: unknown;
};

export type JiraCreateField = {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue: boolean;
  schema: JiraFieldSchema | null;
  allowedValues: JiraAllowedValue[] | null;
};

export type JiraStatus = {
  id: string;
  name: string;
  statusCategory?: { key?: string; name?: string };
};

export type JiraIssueTypeStatuses = {
  id: string;
  name: string;
  statuses: JiraStatus[];
};

export type JiraComponent = { id: string; name: string };

export type JiraIssue = {
  id: string;
  key: string;
  self?: string;
  fields?: Record<string, unknown>;
};

export type JiraCreatedIssue = { id: string; key: string; self?: string };

export type JiraClientConfig = {
  baseUrl: string;
  deployment: JiraDeployment;
  token: string;
  // Jira Cloud only: the Atlassian account email that goes with the API token.
  email?: string | null;
};

const JIRA_FETCH_TIMEOUT_MS = 15_000;
const CREATE_META_PAGE_SIZE = 200;
const CREATE_META_MAX_PAGES = 10;

function authorizationHeader(config: JiraClientConfig): string {
  if (config.deployment === "cloud") {
    const email = config.email?.trim();
    if (!email) {
      throw new JiraApiError(
        "Jira Cloud needs the Atlassian account email together with the API token",
        400,
        "HTTP_ERROR",
      );
    }
    return `Basic ${Buffer.from(`${email}:${config.token}`).toString("base64")}`;
  }
  return `Bearer ${config.token}`;
}

// Jira does not normally echo credentials, but an error text is remote input:
// never let the token (or its Basic form) travel further than the client.
function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function readErrorBody(
  text: string,
  secrets: string[],
): { errorMessages: string[]; errors: Record<string, string> } {
  const errorMessages: string[] = [];
  const errors: Record<string, string> = {};
  try {
    const parsed = JSON.parse(text) as {
      errorMessages?: unknown;
      errors?: unknown;
      message?: unknown;
    };
    if (Array.isArray(parsed.errorMessages)) {
      for (const message of parsed.errorMessages) {
        if (typeof message === "string") {
          errorMessages.push(redactSecrets(message, secrets).slice(0, 1000));
        }
      }
    } else if (typeof parsed.message === "string") {
      errorMessages.push(redactSecrets(parsed.message, secrets).slice(0, 1000));
    }
    if (parsed.errors && typeof parsed.errors === "object") {
      for (const [field, message] of Object.entries(parsed.errors)) {
        if (typeof message === "string") {
          errors[field.slice(0, 200)] = redactSecrets(message, secrets).slice(
            0,
            1000,
          );
        }
      }
    }
  } catch {
    // Not JSON (a proxy page): the status alone describes the failure.
  }
  return { errorMessages: errorMessages.slice(0, 20), errors };
}

async function jiraFetch<T>(
  config: JiraClientConfig,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T | undefined> {
  const root = normalizeJiraBaseUrl(config.baseUrl);
  const url = `${root}${path.startsWith("/") ? path : `/${path}`}`;
  const authorization = authorizationHeader(config);
  const secrets = [config.token, authorization.replace(/^(Basic|Bearer) /, "")];

  try {
    await assertPublicDestination(root, "Jira");
    assertJiraTransport(root);
  } catch (error) {
    throw new JiraApiError(
      error instanceof Error ? error.message : "Jira destination not allowed",
      400,
      "DESTINATION",
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, JIRA_FETCH_TIMEOUT_MS);

  try {
    Sentry.addBreadcrumb({
      category: "integration",
      level: "info",
      data: { integration: "jira" },
    });
    const res = await withoutOutboundTelemetry(() =>
      fetch(url, {
        method: init?.method ?? "GET",
        signal: controller.signal,
        // A redirect could lead past the destination check to an internal host.
        redirect: "manual",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Content-Type": "application/json",
          // Jira XSRF check rejects some browser-like requests; this opts out.
          "X-Atlassian-Token": "no-check",
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    );

    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel().catch(() => {});
      throw new JiraApiError(
        `Jira request was redirected (HTTP ${res.status})`,
        res.status,
        "REDIRECT",
      );
    }

    const text = await res.text();

    if (!res.ok) {
      const { errorMessages, errors } = readErrorBody(text, secrets);
      throw new JiraApiError(
        `Jira API error ${res.status}${errorMessages[0] ? `: ${errorMessages[0]}` : ""}`,
        res.status,
        "HTTP_ERROR",
        errorMessages,
        errors,
      );
    }

    if (res.status === 204 || text === "") {
      return undefined;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new JiraApiError(
        "Jira API returned invalid JSON",
        res.status,
        "INVALID_JSON",
      );
    }
  } catch (error) {
    if (error instanceof JiraApiError) {
      throw error;
    }
    if (timedOut) {
      throw new JiraApiError(
        `Jira request timed out after ${JIRA_FETCH_TIMEOUT_MS}ms`,
        408,
        "TIMEOUT",
      );
    }
    // The original error is dropped on purpose: it can carry request details.
    throw new JiraApiError("Jira request failed", 502, "NETWORK");
  } finally {
    clearTimeout(timeoutId);
  }
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null) {
    throw new JiraApiError(
      `Jira ${what} response was empty`,
      502,
      "EMPTY_RESPONSE",
    );
  }
  return value;
}

type RawCreateField = {
  fieldId?: string;
  key?: string;
  name?: string;
  required?: boolean;
  hasDefaultValue?: boolean;
  schema?: JiraFieldSchema;
  allowedValues?: JiraAllowedValue[];
};

function toCreateField(
  fieldId: string,
  raw: RawCreateField,
): JiraCreateField | null {
  if (!fieldId) return null;
  return {
    fieldId,
    name: raw.name ?? fieldId,
    required: raw.required === true,
    hasDefaultValue: raw.hasDefaultValue === true,
    schema: raw.schema ?? null,
    allowedValues: Array.isArray(raw.allowedValues) ? raw.allowedValues : null,
  };
}

export function createJiraClient(config: JiraClientConfig) {
  const call = <T>(path: string, init?: { method?: string; body?: unknown }) =>
    jiraFetch<T>(config, path, init);
  const segment = encodeURIComponent;
  const isCloud = config.deployment === "cloud";
  // Server and Data Center search by `username`, Cloud by `query`.
  const userQuery = (query: string) =>
    `${isCloud ? "query" : "username"}=${encodeURIComponent(query)}`;

  return {
    async myself(): Promise<JiraUser> {
      return required(await call<JiraUser>("/rest/api/2/myself"), "myself");
    },

    async listProjects(): Promise<JiraProject[]> {
      return required(
        await call<JiraProject[]>("/rest/api/2/project"),
        "project list",
      );
    },

    async listIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
      const project = required(
        await call<{ issueTypes?: JiraIssueType[] }>(
          `/rest/api/2/project/${segment(projectKey)}`,
        ),
        "project",
      );
      return project.issueTypes ?? [];
    },

    // The new createmeta endpoints (Server/DC 8.4+, Cloud) answer 404 on older
    // Jira versions, which only have the expanded legacy query.
    async getCreateFields(
      projectKey: string,
      issueTypeId: string,
    ): Promise<JiraCreateField[]> {
      const fields: JiraCreateField[] = [];
      try {
        for (let page = 0; page < CREATE_META_MAX_PAGES; page++) {
          const startAt = page * CREATE_META_PAGE_SIZE;
          const response = required(
            await call<{
              values?: RawCreateField[];
              fields?: RawCreateField[];
              total?: number;
            }>(
              `/rest/api/2/issue/createmeta/${segment(projectKey)}/issuetypes/${segment(issueTypeId)}?startAt=${startAt}&maxResults=${CREATE_META_PAGE_SIZE}`,
            ),
            "create metadata",
          );
          const items = response.values ?? response.fields ?? [];
          for (const item of items) {
            const field = toCreateField(item.fieldId ?? item.key ?? "", item);
            if (field) fields.push(field);
          }
          if (
            items.length < CREATE_META_PAGE_SIZE ||
            (response.total !== undefined && fields.length >= response.total)
          ) {
            break;
          }
        }
        return fields;
      } catch (error) {
        if (!(error instanceof JiraApiError) || error.status !== 404) {
          throw error;
        }
      }

      const legacy = required(
        await call<{
          projects?: {
            issuetypes?: { fields?: Record<string, RawCreateField> }[];
          }[];
        }>(
          `/rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeIds=${encodeURIComponent(issueTypeId)}&expand=projects.issuetypes.fields`,
        ),
        "create metadata",
      );
      const map = legacy.projects?.[0]?.issuetypes?.[0]?.fields ?? {};
      return Object.entries(map).flatMap(([fieldId, raw]) => {
        const field = toCreateField(fieldId, raw);
        return field ? [field] : [];
      });
    },

    async listStatuses(projectKey: string): Promise<JiraIssueTypeStatuses[]> {
      return required(
        await call<JiraIssueTypeStatuses[]>(
          `/rest/api/2/project/${segment(projectKey)}/statuses`,
        ),
        "status list",
      );
    },

    async listComponents(projectKey: string): Promise<JiraComponent[]> {
      return required(
        await call<JiraComponent[]>(
          `/rest/api/2/project/${segment(projectKey)}/components`,
        ),
        "component list",
      );
    },

    async searchUsers(query: string, projectKey?: string): Promise<JiraUser[]> {
      const path = projectKey
        ? `/rest/api/2/user/assignable/search?project=${segment(projectKey)}&${userQuery(query)}&maxResults=50`
        : `/rest/api/2/user/search?${userQuery(query)}&maxResults=50`;
      return required(await call<JiraUser[]>(path), "user search");
    },

    async createIssue(
      fields: Record<string, unknown>,
    ): Promise<JiraCreatedIssue> {
      return required(
        await call<JiraCreatedIssue>("/rest/api/2/issue", {
          method: "POST",
          body: { fields },
        }),
        "created issue",
      );
    },

    async updateIssue(
      key: string,
      fields: Record<string, unknown>,
    ): Promise<void> {
      await call(`/rest/api/2/issue/${segment(key)}`, {
        method: "PUT",
        body: { fields },
      });
    },

    async getIssue(key: string, fields: string[]): Promise<JiraIssue> {
      const query = fields.length
        ? `?fields=${fields.map(segment).join(",")}`
        : "";
      return required(
        await call<JiraIssue>(`/rest/api/2/issue/${segment(key)}${query}`),
        "issue",
      );
    },

    // Jira Cloud removed `/rest/api/2/search` in favour of `/search/jql`.
    async searchIssues(jql: string, fields: string[]): Promise<JiraIssue[]> {
      const response = required(
        await call<{ issues?: JiraIssue[] }>(
          isCloud ? "/rest/api/2/search/jql" : "/rest/api/2/search",
          {
            method: "POST",
            body: { jql, fields, maxResults: 100 },
          },
        ),
        "search",
      );
      return response.issues ?? [];
    },
  };
}

export type JiraClient = ReturnType<typeof createJiraClient>;
