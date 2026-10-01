import { HTTPException } from "hono/http-exception";
import { privateDestinationsAllowed } from "../utils/assert-public-destination";

export const JIRA_DEPLOYMENTS = ["server", "cloud"] as const;
export type JiraDeployment = (typeof JIRA_DEPLOYMENTS)[number];

// The Jira REST path (`/rest/api/2/...`) is appended to this URL, so a context
// path (`https://host/jira`) is kept and a query or fragment is refused.
export function normalizeJiraBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Jira base URL must use http or https");
  }

  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(
      "Jira base URL must not contain a query, fragment, or credentials",
    );
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

// The token travels in a request header, so plain http is only accepted for
// instances on a private network (same rule as GitLab and Gitea).
export function assertJiraTransport(baseUrl: string): void {
  if (new URL(baseUrl).protocol === "http:" && !privateDestinationsAllowed()) {
    throw new Error(
      "Jira URL must use https unless KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS is enabled",
    );
  }
}

// Normalizes a user-supplied base URL and applies the transport rule, turning
// either failure into a 400.
export function parseJiraBaseUrl(url: string): string {
  try {
    const normalized = normalizeJiraBaseUrl(url);
    assertJiraTransport(normalized);
    return normalized;
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : "Invalid Jira URL",
    });
  }
}
