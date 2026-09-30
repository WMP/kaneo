import { JiraRequestError } from "@/fetchers/jira-integration/jira-request-error";

// The codes of the Jira routes a person can act on map to translated copy.
// Static keys keep the i18n checker able to see every string in use.
const ERROR_KEYS_BY_CODE = {
  JIRA_TOKEN_MISSING: "settings:jiraIntegration.errors.tokenMissing",
  JIRA_TOKEN_INVALID: "settings:jiraIntegration.errors.tokenInvalid",
  JIRA_ENCRYPTION_KEY_MISSING:
    "settings:jiraIntegration.errors.encryptionKeyMissing",
  JIRA_NOT_CONFIGURED: "settings:jiraIntegration.errors.notConfigured",
  JIRA_REQUEST_FAILED: "settings:jiraIntegration.errors.requestFailed",
  JIRA_ISSUE_ALREADY_LINKED:
    "settings:jiraIntegration.errors.issueAlreadyLinked",
  JIRA_NOT_LINKED: "settings:jiraIntegration.errors.notLinked",
  PROPOSAL_NOT_PENDING: "settings:jiraIntegration.errors.proposalNotPending",
  STATUS_REQUIRED: "settings:jiraIntegration.errors.statusRequired",
} as const;

export function getJiraErrorCode(error: unknown): string | undefined {
  return error instanceof JiraRequestError ? error.code : undefined;
}

// Jira's own messages (`errorMessages`, `errors`) for JIRA_REQUEST_FAILED. They
// come from Jira, never from the token, and say what Jira objected to.
export function getJiraFailureDetails(
  error: unknown,
  { excludeFieldIds = [] }: { excludeFieldIds?: string[] } = {},
): string[] {
  if (!(error instanceof JiraRequestError)) return [];
  const fieldMessages = Object.entries(error.errors)
    .filter(([fieldId]) => !excludeFieldIds.includes(fieldId))
    .map(([, message]) => message);
  return [...error.errorMessages, ...fieldMessages].filter(
    (message) => message.trim() !== "",
  );
}

/**
 * Jira's per-field messages (`errors[fieldId]`) that belong to one of `fieldIds`,
 * so a form can show them under the field they are about. Messages about any
 * other field stay in `getJiraFailureDetails`.
 */
export function getJiraFieldErrors(
  error: unknown,
  fieldIds: string[],
): Record<string, string> {
  if (!(error instanceof JiraRequestError)) return {};
  return Object.fromEntries(
    Object.entries(error.errors).filter(
      ([fieldId, message]) =>
        fieldIds.includes(fieldId) && message.trim() !== "",
    ),
  );
}

/**
 * The text to show for a failed Jira request: translated for a known code (with
 * Jira's own messages appended for a failed Jira call, except the fields named
 * in `excludeFieldIds` that the caller shows itself), the API's message for a
 * rejected input (a 400 explains what to change, e.g. an unusable base URL or
 * an invalid status), else `fallbackKey`.
 */
export function getJiraErrorMessage(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
  options: { excludeFieldIds?: string[] } = {},
): string {
  const code = getJiraErrorCode(error);
  const knownKey = code
    ? ERROR_KEYS_BY_CODE[code as keyof typeof ERROR_KEYS_BY_CODE]
    : undefined;
  if (knownKey) {
    const details = getJiraFailureDetails(error, options);
    return details.length > 0
      ? `${t(knownKey)} ${details.join(" ")}`
      : t(knownKey);
  }
  if (
    error instanceof JiraRequestError &&
    error.status === 400 &&
    error.message.trim()
  ) {
    return error.message;
  }
  return t(fallbackKey);
}
