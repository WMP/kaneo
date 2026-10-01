import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import createActivity from "../activity/controllers/create-activity";
import db from "../database";
import { jiraIssueLinkTable, type taskTable } from "../database/schema";
import { publishEvent } from "../events";
import { isUniqueViolation } from "../utils/pg-error";
import type { JiraDeployment } from "./config";
import type { DraftWarning } from "./draft";
import { describeJiraFailure, jiraError, withJiraErrors } from "./errors";
import {
  buildJiraIssueFields,
  JiraFieldValueError,
  type TypedFieldValue,
} from "./field-values";
import type { JiraClient } from "./jira-client";
import {
  buildIssueUrl,
  findLinkByTask,
  type JiraIssueLinkRow,
  readIssueStatus,
} from "./links";
import { resolveMappingForUser } from "./mapping-store";
import { processJiraStatusChange } from "./status-sync";
import { getJiraClientForUser } from "./tokens";

type TaskRow = typeof taskTable.$inferSelect;

export type SendBody = {
  jiraProjectKey?: string;
  issueTypeId?: string;
  fields: TypedFieldValue[];
};

// The status of an issue, or a warning when Jira cannot say. The issue exists
// either way, so this never fails a send.
async function readStatus(client: JiraClient, issueKey: string) {
  try {
    const issue = await client.getIssue(issueKey, ["status"]);
    return { status: readIssueStatus(issue), warning: null };
  } catch (error) {
    const failure = describeJiraFailure(error);
    return {
      status: null,
      warning: {
        code: "JIRA_STATUS_UNAVAILABLE",
        message: `The issue was saved in Jira, but its status could not be read: ${failure.message}`,
      } satisfies DraftWarning,
    };
  }
}

function valueMapsOf(
  fieldMappings: {
    target: { fieldId: string };
    valueMap?: Record<string, string>;
  }[],
) {
  const maps: Record<string, Record<string, string>> = {};
  for (const mapping of fieldMappings) {
    if (mapping.valueMap) maps[mapping.target.fieldId] = mapping.valueMap;
  }
  return maps;
}

async function publishSafely(eventType: string, data: unknown) {
  try {
    await publishEvent(eventType, data);
  } catch (error) {
    console.error(`Failed to publish ${eventType}`, error);
  }
}

// Sends the task to Jira as the CALLER: creates the issue, or updates the one
// the task is linked to, always with the caller's own token. Only typed field
// values arrive from the client; they are converted here.
export async function sendTaskToJira({
  task,
  workspaceId,
  userId,
  body,
}: {
  task: TaskRow;
  workspaceId: string;
  userId: string;
  body: SendBody;
}): Promise<{
  created: boolean;
  link: JiraIssueLinkRow;
  warnings: DraftWarning[];
}> {
  const { client, connection } = await getJiraClientForUser(
    workspaceId,
    userId,
  );
  const deployment = connection.deployment as JiraDeployment;
  const existing = await findLinkByTask(task.id);

  if (!existing && (!body.jiraProjectKey || !body.issueTypeId)) {
    throw new HTTPException(400, {
      message:
        "jiraProjectKey and issueTypeId are required to create a Jira issue.",
    });
  }

  const mapping = await resolveMappingForUser({
    workspaceId,
    projectId: task.projectId,
    userId,
  });

  let fields: Record<string, unknown>;
  try {
    fields = buildJiraIssueFields({
      deployment,
      fields: body.fields,
      valueMaps: valueMapsOf(mapping.fieldMappings),
      create:
        !existing && body.jiraProjectKey && body.issueTypeId
          ? {
              jiraProjectKey: body.jiraProjectKey,
              issueTypeId: body.issueTypeId,
            }
          : undefined,
    });
  } catch (error) {
    if (error instanceof JiraFieldValueError) {
      throw new HTTPException(400, {
        message: `Field "${error.fieldId}": ${error.message}`,
      });
    }
    throw error;
  }

  const warnings: DraftWarning[] = [];

  if (existing) {
    // Nothing to send is not an error, and never clears a field in Jira.
    if (Object.keys(fields).length > 0) {
      await withJiraErrors(() => client.updateIssue(existing.issueKey, fields));
    }
    const { status, warning } = await readStatus(client, existing.issueKey);
    if (warning) warnings.push(warning);
    if (status) {
      // A status that moved in Jira meanwhile is seen here like anywhere else:
      // recorded and proposed, never applied.
      await processJiraStatusChange(existing, {
        statusId: status.id,
        statusName: status.name,
        source: "manual",
        actorUserId: userId,
      });
    }

    await createActivity(task.id, "jira_issue_updated", userId, null, {
      issueKey: existing.issueKey,
      issueUrl: existing.issueUrl,
    });
    await publishSafely("jira.issue_linked", {
      taskId: task.id,
      projectId: task.projectId,
      userId,
      linkId: existing.id,
      issueKey: existing.issueKey,
      created: false,
    });

    const link = (await findLinkByTask(task.id)) ?? existing;
    return { created: false, link, warnings };
  }

  const issue = await withJiraErrors(() => client.createIssue(fields));
  const issueId = String(issue.id);
  const issueKey = issue.key;
  const issueUrl = buildIssueUrl(connection.baseUrl, issueKey);

  const { status, warning } = await readStatus(client, issueKey);
  if (warning) warnings.push(warning);

  // The issue exists in Jira now. If Kaneo cannot link it, say so instead of
  // leaving the person to send again and create a second issue.
  const [linkedElsewhere] = await db
    .select({ taskId: jiraIssueLinkTable.taskId })
    .from(jiraIssueLinkTable)
    .where(
      and(
        eq(jiraIssueLinkTable.connectionId, connection.id),
        eq(jiraIssueLinkTable.issueId, issueId),
      ),
    )
    .limit(1);
  if (linkedElsewhere) {
    throw alreadyLinked(issueKey);
  }

  let link: JiraIssueLinkRow | undefined;
  try {
    [link] = await db
      .insert(jiraIssueLinkTable)
      .values({
        taskId: task.id,
        connectionId: connection.id,
        issueId,
        issueKey,
        issueUrl,
        jiraProjectKey: body.jiraProjectKey ?? issueKey.split("-")[0] ?? "",
        lastStatusId: status?.id ?? null,
        lastStatusName: status?.name ?? null,
        lastSyncedAt: status ? new Date() : null,
        createdByUserId: userId,
      })
      .returning();
  } catch (error) {
    // Unique on the task (a second send won the race) or on the Jira issue.
    if (isUniqueViolation(error)) throw alreadyLinked(issueKey);
    throw error;
  }
  if (!link) {
    throw new HTTPException(500, { message: "Failed to store the Jira link" });
  }

  await createActivity(task.id, "jira_issue_created", userId, null, {
    issueKey,
    issueUrl,
  });
  await publishSafely("jira.issue_linked", {
    taskId: task.id,
    projectId: task.projectId,
    userId,
    linkId: link.id,
    issueKey,
    created: true,
  });

  return { created: true, link, warnings };
}

function alreadyLinked(issueKey: string) {
  return jiraError(
    409,
    "JIRA_ISSUE_ALREADY_LINKED",
    `The Jira issue ${issueKey} is already linked to a Kaneo task, or this task already has a Jira issue. It was created in Jira and is not linked here.`,
  );
}
