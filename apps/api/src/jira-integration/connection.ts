import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { jiraConnectionTable, jiraUserTokenTable } from "../database/schema";
import {
  isDisallowedAddress,
  privateDestinationsAllowed,
} from "../utils/assert-public-destination";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import { type JiraDeployment, parseJiraBaseUrl } from "./config";
import { findJiraConnection, type JiraConnectionRow } from "./tokens";

function newWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

// The webhook URL carries the secret because Jira Server webhooks cannot sign
// requests. Only callers with workspace:manage_settings ever receive it.
export function toConnectionResponse(
  connection: JiraConnectionRow,
  includeSecrets: boolean,
) {
  const apiBase = normalizeApiServerUrl(
    process.env.KANEO_API_URL || "http://localhost:1337",
  ).replace(/\/$/, "");
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    baseUrl: connection.baseUrl,
    deployment: connection.deployment as JiraDeployment,
    isActive: connection.isActive,
    pollingEnabled: connection.pollingEnabled,
    ...(includeSecrets
      ? {
          webhookUrl: `${apiBase}/jira-integration/webhook/${connection.id}?secret=${connection.webhookSecret}`,
          webhookSecret: connection.webhookSecret,
        }
      : {}),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

// A literal private address is refused early; hostnames are resolved and
// checked on every request by the client, so a DNS hiccup never blocks saving.
function assertReachableTarget(baseUrl: string): void {
  if (privateDestinationsAllowed()) return;
  if (isDisallowedAddress(new URL(baseUrl).hostname)) {
    throw new HTTPException(400, {
      message: "Jira destination resolves to a non-routable address",
    });
  }
}

export async function upsertJiraConnection({
  workspaceId,
  baseUrl,
  deployment,
  isActive,
  pollingEnabled,
}: {
  workspaceId: string;
  baseUrl: string;
  deployment: JiraDeployment;
  isActive?: boolean;
  pollingEnabled?: boolean;
}): Promise<JiraConnectionRow> {
  const normalized = parseJiraBaseUrl(baseUrl);
  assertReachableTarget(normalized);

  const existing = await findJiraConnection(workspaceId);

  if (!existing) {
    const [created] = await db
      .insert(jiraConnectionTable)
      .values({
        workspaceId,
        baseUrl: normalized,
        deployment,
        isActive: isActive ?? true,
        pollingEnabled: pollingEnabled ?? true,
        webhookSecret: newWebhookSecret(),
      })
      .returning();
    if (!created) {
      throw new HTTPException(500, {
        message: "Failed to create Jira connection",
      });
    }
    return created;
  }

  const targetChanged =
    existing.baseUrl !== normalized || existing.deployment !== deployment;

  return db.transaction(async (tx) => {
    // A token is only ever sent to the instance it was verified against: when
    // the target changes, every stored token is dropped and people enter theirs
    // again, so a new address never receives a credential given for the old one.
    if (targetChanged) {
      await tx
        .delete(jiraUserTokenTable)
        .where(eq(jiraUserTokenTable.connectionId, existing.id));
    }
    const [updated] = await tx
      .update(jiraConnectionTable)
      .set({
        baseUrl: normalized,
        deployment,
        isActive: isActive ?? existing.isActive,
        pollingEnabled: pollingEnabled ?? existing.pollingEnabled,
        updatedAt: new Date(),
      })
      .where(eq(jiraConnectionTable.id, existing.id))
      .returning();
    if (!updated) {
      throw new HTTPException(500, {
        message: "Failed to update Jira connection",
      });
    }
    return updated;
  });
}

export async function rotateJiraWebhookSecret(
  connectionId: string,
): Promise<JiraConnectionRow> {
  const [updated] = await db
    .update(jiraConnectionTable)
    .set({ webhookSecret: newWebhookSecret(), updatedAt: new Date() })
    .where(eq(jiraConnectionTable.id, connectionId))
    .returning();
  if (!updated) {
    throw new HTTPException(404, { message: "Jira connection not found" });
  }
  return updated;
}

export async function deleteJiraConnection(
  connectionId: string,
): Promise<void> {
  // Tokens, links and proposals go with it (ON DELETE CASCADE).
  await db
    .delete(jiraConnectionTable)
    .where(eq(jiraConnectionTable.id, connectionId));
}
