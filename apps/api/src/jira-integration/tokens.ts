import { and, eq } from "drizzle-orm";
import db from "../database";
import { jiraConnectionTable, jiraUserTokenTable } from "../database/schema";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../notification-preferences/secrets";
import type { JiraDeployment } from "./config";
import { jiraError } from "./errors";
import { createJiraClient, type JiraUser } from "./jira-client";

export type JiraConnectionRow = typeof jiraConnectionTable.$inferSelect;
export type JiraUserTokenRow = typeof jiraUserTokenTable.$inferSelect;

// Kaneo never stores a plaintext token: without the key, refuse to store one.
export function assertJiraEncryptionKey(): void {
  if (!process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY?.trim()) {
    throw jiraError(
      503,
      "JIRA_ENCRYPTION_KEY_MISSING",
      "NOTIFICATION_SECRET_ENCRYPTION_KEY is not set, so Jira tokens cannot be stored. Ask an administrator to configure it.",
    );
  }
}

export async function findJiraConnection(
  workspaceId: string,
): Promise<JiraConnectionRow | null> {
  const [connection] = await db
    .select()
    .from(jiraConnectionTable)
    .where(eq(jiraConnectionTable.workspaceId, workspaceId))
    .limit(1);
  return connection ?? null;
}

export async function requireJiraConnection(
  workspaceId: string,
): Promise<JiraConnectionRow> {
  const connection = await findJiraConnection(workspaceId);
  if (!connection) {
    throw jiraError(
      404,
      "JIRA_NOT_CONFIGURED",
      "This workspace has no Jira connection.",
    );
  }
  return connection;
}

export async function findJiraUserToken(
  connectionId: string,
  userId: string,
): Promise<JiraUserTokenRow | null> {
  const [row] = await db
    .select()
    .from(jiraUserTokenTable)
    .where(
      and(
        eq(jiraUserTokenTable.connectionId, connectionId),
        eq(jiraUserTokenTable.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// What the API says about a token. The token itself is never part of it.
export function toTokenStatus(row: JiraUserTokenRow | null) {
  return {
    connected: row !== null,
    jiraAccountId: row?.jiraAccountId ?? null,
    jiraUsername: row?.jiraUsername ?? null,
    jiraDisplayName: row?.jiraDisplayName ?? null,
    email: row?.email ?? null,
    lastVerifiedAt: row?.lastVerifiedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function storeJiraUserToken({
  connectionId,
  userId,
  token,
  email,
  identity,
}: {
  connectionId: string;
  userId: string;
  token: string;
  email: string | null;
  identity: JiraUser;
}): Promise<JiraUserTokenRow> {
  assertJiraEncryptionKey();
  const encryptedToken = encryptSecret(token);
  if (!encryptedToken) {
    throw jiraError(
      503,
      "JIRA_ENCRYPTION_KEY_MISSING",
      "The Jira token could not be encrypted.",
    );
  }

  const values = {
    encryptedToken,
    email,
    jiraAccountId: identity.accountId ?? null,
    jiraUsername: identity.name ?? identity.key ?? null,
    jiraDisplayName: identity.displayName ?? null,
    lastVerifiedAt: new Date(),
    lastError: null,
  };

  const [row] = await db
    .insert(jiraUserTokenTable)
    .values({ connectionId, userId, ...values })
    .onConflictDoUpdate({
      target: [jiraUserTokenTable.connectionId, jiraUserTokenTable.userId],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  if (!row) {
    throw new Error("Failed to store the Jira token");
  }
  return row;
}

export async function deleteJiraUserToken(
  connectionId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(jiraUserTokenTable)
    .where(
      and(
        eq(jiraUserTokenTable.connectionId, connectionId),
        eq(jiraUserTokenTable.userId, userId),
      ),
    );
}

export function decryptJiraToken(row: JiraUserTokenRow): string {
  assertJiraEncryptionKey();
  // decryptSecret passes an unencrypted value through; a token is always
  // stored encrypted, so anything else is not one of ours.
  if (!isEncryptedSecret(row.encryptedToken)) {
    throw jiraError(
      422,
      "JIRA_TOKEN_INVALID",
      "The stored Jira token cannot be read. Enter it again.",
    );
  }
  try {
    const token = decryptSecret(row.encryptedToken);
    if (token) return token;
  } catch {
    // Wrong key or damaged value: fall through to the same answer.
  }
  throw jiraError(
    422,
    "JIRA_TOKEN_INVALID",
    "The stored Jira token cannot be read. Enter it again.",
  );
}

// The Jira client that acts as `userId`: every request made for a user uses
// that user's own token, never another person's.
export async function getJiraClientForUser(
  workspaceId: string,
  userId: string,
) {
  const connection = await requireJiraConnection(workspaceId);
  if (!connection.isActive) {
    throw jiraError(
      404,
      "JIRA_NOT_CONFIGURED",
      "The Jira connection of this workspace is turned off.",
    );
  }

  const row = await findJiraUserToken(connection.id, userId);
  if (!row) {
    throw jiraError(
      409,
      "JIRA_TOKEN_MISSING",
      "You have not connected a Jira token for this workspace.",
    );
  }

  const client = createJiraClient({
    baseUrl: connection.baseUrl,
    deployment: connection.deployment as JiraDeployment,
    token: decryptJiraToken(row),
    email: row.email,
  });

  return { client, connection, tokenRow: row };
}
