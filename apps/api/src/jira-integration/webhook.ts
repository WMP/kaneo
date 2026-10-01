import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import db from "../database";
import { jiraConnectionTable, jiraIssueLinkTable } from "../database/schema";
import { processJiraStatusChange } from "./status-sync";
import { parseJiraStatusWebhook } from "./webhook-payload";

// A status change event is a few KB; nothing legitimate comes near this.
export const JIRA_WEBHOOK_MAX_BYTES = 256 * 1024;

export const jiraWebhookBodyLimit = bodyLimit({
  maxSize: JIRA_WEBHOOK_MAX_BYTES,
  onError: (c) => c.json({ error: "Payload too large" }, 413),
});

// Both sides are hashed first, so the comparison takes the same time whatever
// the length of what was sent, and never reveals how much of it matched.
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

// Compared against for a connection that does not exist, so an unknown id costs
// the same as a wrong secret and answers the same way.
const UNKNOWN_CONNECTION_SECRET = createHash("sha256")
  .update("jira-webhook-unknown-connection")
  .digest("hex");

// Public route (no session): the secret in the URL is the only credential,
// because Jira Server webhooks cannot sign a request. A wrong secret and an
// unknown connection both answer 401, so the route is not a way to find out
// which connections exist.
export async function handleJiraWebhookRoute(c: Context) {
  const connectionId = c.req.param("connectionId");
  const secret = c.req.query("secret") ?? "";

  const [connection] = connectionId
    ? await db
        .select()
        .from(jiraConnectionTable)
        .where(eq(jiraConnectionTable.id, connectionId))
        .limit(1)
    : [];

  const matches = secretsMatch(
    secret,
    connection?.webhookSecret ?? UNKNOWN_CONNECTION_SECRET,
  );
  if (!connection || !matches || secret === "") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // A switched-off connection is not an error for Jira to retry.
  if (!connection.isActive) {
    return c.json({ status: "ignored" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await c.req.text());
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const change = parseJiraStatusWebhook(payload);
  if (!change) {
    return c.json({ status: "ignored" });
  }

  // By the issue id, which survives a key change; the key is the fallback.
  const [byId] = change.issueId
    ? await db
        .select()
        .from(jiraIssueLinkTable)
        .where(
          and(
            eq(jiraIssueLinkTable.connectionId, connection.id),
            eq(jiraIssueLinkTable.issueId, change.issueId),
          ),
        )
        .limit(1)
    : [];
  const [byKey] =
    !byId && change.issueKey
      ? await db
          .select()
          .from(jiraIssueLinkTable)
          .where(
            and(
              eq(jiraIssueLinkTable.connectionId, connection.id),
              eq(jiraIssueLinkTable.issueKey, change.issueKey),
            ),
          )
          .limit(1)
      : [];
  const link = byId ?? byKey;
  if (!link) {
    return c.json({ status: "ignored" });
  }

  const result = await processJiraStatusChange(link, {
    statusId: change.statusId,
    statusName: change.statusName,
    fromStatusName: change.fromStatusName,
    changedBy: change.changedBy,
    changedAt: change.changedAt,
    source: "webhook",
  });

  return c.json({ status: result.changed ? "processed" : "ignored" });
}
