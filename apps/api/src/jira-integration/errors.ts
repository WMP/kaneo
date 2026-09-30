import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { JiraApiError } from "./jira-client";

export type JiraErrorCode =
  | "JIRA_NOT_CONFIGURED"
  | "JIRA_TOKEN_MISSING"
  | "JIRA_TOKEN_INVALID"
  | "JIRA_ENCRYPTION_KEY_MISSING"
  | "JIRA_REQUEST_FAILED";

// JSON error with a machine-readable `code`; `extra` carries Jira's own
// messages. Never put a credential in any of these fields.
export function jiraError(
  status: ContentfulStatusCode,
  code: JiraErrorCode,
  message: string,
  extra: {
    jiraStatus?: number;
    errorMessages?: string[];
    errors?: Record<string, string>;
  } = {},
): HTTPException {
  return new HTTPException(status, {
    message,
    res: Response.json({ code, message, ...extra }, { status }),
  });
}

// A Jira 401 means the caller's token was rejected. It is answered as 422, not
// 401, because the web client reads a 401 from Kaneo as an expired session.
export function toJiraHttpError(error: unknown): HTTPException {
  if (error instanceof HTTPException) return error;
  if (error instanceof JiraApiError) {
    if (error.kind === "HTTP_ERROR" && error.status === 401) {
      return jiraError(
        422,
        "JIRA_TOKEN_INVALID",
        "Jira rejected the token. Enter a valid token again.",
        { jiraStatus: 401 },
      );
    }
    return jiraError(
      error.kind === "DESTINATION" ? 400 : 502,
      "JIRA_REQUEST_FAILED",
      error.message,
      {
        jiraStatus: error.kind === "HTTP_ERROR" ? error.status : undefined,
        errorMessages: error.errorMessages,
        errors: error.errors,
      },
    );
  }
  throw error;
}

// Runs a Jira call and converts a client failure into the coded HTTP error.
export async function withJiraErrors<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw toJiraHttpError(error);
  }
}
