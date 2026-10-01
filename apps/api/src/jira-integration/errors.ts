import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { JiraApiError } from "./jira-client";

export type JiraErrorCode =
  | "JIRA_NOT_CONFIGURED"
  | "JIRA_TOKEN_MISSING"
  | "JIRA_TOKEN_INVALID"
  | "JIRA_ENCRYPTION_KEY_MISSING"
  | "JIRA_REQUEST_FAILED"
  | "JIRA_ISSUE_ALREADY_LINKED"
  | "JIRA_NOT_LINKED"
  | "PROPOSAL_NOT_PENDING"
  | "STATUS_REQUIRED";

// An HTTPException that also knows its machine-readable code, so a caller that
// only wants to report a failure (a draft warning, a poll result) does not have
// to parse the response body.
export class JiraHttpError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public code: JiraErrorCode,
    message: string,
    res: Response,
  ) {
    super(status, { message, res });
  }
}

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
): JiraHttpError {
  return new JiraHttpError(
    status,
    code,
    message,
    Response.json({ code, message, ...extra }, { status }),
  );
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

// Code and message of a failed Jira call, for places that report the failure
// instead of answering with it. Anything that is not a Jira failure is thrown.
export function describeJiraFailure(error: unknown): {
  code: JiraErrorCode;
  message: string;
} {
  const converted = toJiraHttpError(error);
  if (converted instanceof JiraHttpError) {
    return { code: converted.code, message: converted.message };
  }
  throw error;
}
