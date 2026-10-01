import { HttpError } from "@/lib/http-error";

// A failed Jira route answers JSON `{ code, message, errorMessages?, errors?,
// jiraStatus? }`. The code is what the UI reacts to (a missing token, a
// rejected token, a missing encryption key, ...); Jira's own messages are kept
// for JIRA_REQUEST_FAILED. The token is never part of any of these fields.
export class JiraRequestError extends HttpError {
  code: string | undefined;
  errorMessages: string[];
  errors: Record<string, string>;
  jiraStatus: number | undefined;

  constructor(
    status: number,
    message: string,
    details: {
      code?: string;
      errorMessages?: string[];
      errors?: Record<string, string>;
      jiraStatus?: number;
    } = {},
  ) {
    super(status, message);
    this.name = "JiraRequestError";
    this.code = details.code;
    this.errorMessages = details.errorMessages ?? [];
    this.errors = details.errors ?? {};
    this.jiraStatus = details.jiraStatus;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

// Use as `throw await jiraRequestError(response)` so the response type narrows.
export async function jiraRequestError(response: {
  status: number;
  text(): Promise<string>;
}): Promise<JiraRequestError> {
  const text = await response.text().catch(() => "");
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      return new JiraRequestError(
        response.status,
        typeof record.message === "string" ? record.message : text,
        {
          code: typeof record.code === "string" ? record.code : undefined,
          errorMessages: asStringArray(record.errorMessages),
          errors: asStringRecord(record.errors),
          jiraStatus:
            typeof record.jiraStatus === "number"
              ? record.jiraStatus
              : undefined,
        },
      );
    }
  } catch {
    // Not JSON (a proxy error page, for instance): fall through.
  }
  return new JiraRequestError(response.status, text || "Request failed");
}
