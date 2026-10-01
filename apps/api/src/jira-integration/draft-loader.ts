import { and, asc, eq, isNull } from "drizzle-orm";
import { getEffectiveCustomFieldDefinitions } from "../custom-field/effective-fields";
import db from "../database";
import {
  customFieldValueTable,
  jiraUserTokenTable,
  labelTable,
  type taskTable,
} from "../database/schema";
import type { JiraDeployment } from "./config";
import {
  applyCreateMeta,
  buildDraftFields,
  type DraftCustomValue,
  type DraftTaskValues,
  type DraftWarning,
  type JiraIdentity,
  type MissingRequiredField,
} from "./draft";
import { describeJiraFailure } from "./errors";
import { findLinkByTask, toLinkResponse } from "./links";
import { resolveMappingForUser } from "./mapping-store";
import {
  findJiraUserToken,
  getJiraClientForUser,
  type JiraConnectionRow,
} from "./tokens";

type TaskRow = typeof taskTable.$inferSelect;

// The values of the task the mapping can draw from.
export async function loadDraftTaskValues(task: TaskRow): Promise<{
  values: DraftTaskValues;
  customValues: Record<string, DraftCustomValue>;
}> {
  const [labels, storedValues, definitions] = await Promise.all([
    db
      .select({ name: labelTable.name })
      .from(labelTable)
      .where(
        and(
          eq(labelTable.taskId, task.id),
          isNull(labelTable.deletionStartedAt),
        ),
      )
      .orderBy(asc(labelTable.name)),
    db
      .select({
        fieldId: customFieldValueTable.fieldId,
        value: customFieldValueTable.value,
      })
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.taskId, task.id)),
    getEffectiveCustomFieldDefinitions(task.projectId),
  ]);

  // Only fields the project still shows (the effective set drops hidden ones):
  // a hidden or removed field's old value is not the task's data any more.
  const types = new Map(
    definitions.map((definition) => [definition.id, definition.type]),
  );
  const customValues: Record<string, DraftCustomValue> = {};
  for (const stored of storedValues) {
    const type = types.get(stored.fieldId);
    if (type) customValues[stored.fieldId] = { type, value: stored.value };
  }

  return {
    values: {
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
      startDate: task.startDate,
      labels: labels.map((label) => label.name),
      progress: task.progress,
      assigneeUserId: task.userId,
    },
    customValues,
  };
}

// The Jira identity of the assignee's own token in this connection. The token
// itself is never read here.
async function loadAssigneeIdentity(
  connectionId: string,
  assigneeUserId: string | null,
): Promise<JiraIdentity | null> {
  if (!assigneeUserId) return null;
  const [row] = await db
    .select({
      accountId: jiraUserTokenTable.jiraAccountId,
      username: jiraUserTokenTable.jiraUsername,
    })
    .from(jiraUserTokenTable)
    .where(
      and(
        eq(jiraUserTokenTable.connectionId, connectionId),
        eq(jiraUserTokenTable.userId, assigneeUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// What the person is about to send from the task dialog: every mapped field
// with its value, where it came from, and, when Jira's create metadata can be
// read with the caller's own token, which are required and what they allow.
// A Jira failure is a warning here, never an error: the dialog still opens.
export async function buildTaskDraft({
  task,
  workspaceId,
  userId,
  connection,
  overrides,
}: {
  task: TaskRow;
  workspaceId: string;
  userId: string;
  connection: JiraConnectionRow;
  overrides: { jiraProjectKey?: string; issueTypeId?: string };
}) {
  const deployment = connection.deployment as JiraDeployment;
  const [mapping, { values, customValues }, link, tokenRow, assigneeIdentity] =
    await Promise.all([
      resolveMappingForUser({
        workspaceId,
        projectId: task.projectId,
        userId,
      }),
      loadDraftTaskValues(task),
      findLinkByTask(task.id),
      findJiraUserToken(connection.id, userId),
      loadAssigneeIdentity(connection.id, task.userId),
    ]);

  const built = buildDraftFields({
    mapping,
    task: values,
    customValues,
    deployment,
    assigneeIdentity,
  });
  let fields = built.fields;
  const warnings: DraftWarning[] = [...built.warnings];
  let missingRequired: MissingRequiredField[] = [];
  let createMeta: { jiraProjectKey: string; issueTypeId: string } | null = null;

  const jiraProjectKey =
    overrides.jiraProjectKey ??
    link?.jiraProjectKey ??
    mapping.jiraProjectKey.value;
  const issueTypeId = overrides.issueTypeId ?? mapping.issueTypeId.value;

  if (!tokenRow) {
    warnings.push({
      code: "JIRA_TOKEN_MISSING",
      message:
        "You have not connected a Jira token for this workspace, so required fields and allowed values are not shown.",
    });
  } else if (!jiraProjectKey || !issueTypeId) {
    warnings.push({
      code: "JIRA_TARGET_MISSING",
      message:
        "Choose a Jira project and an issue type to see required fields and allowed values.",
    });
  } else {
    try {
      const { client } = await getJiraClientForUser(workspaceId, userId);
      const createFields = await client.getCreateFields(
        jiraProjectKey,
        issueTypeId,
      );
      const applied = applyCreateMeta(fields, createFields);
      fields = applied.fields;
      // An update does not need the create-only required fields.
      missingRequired = link ? [] : applied.missingRequired;
      createMeta = { jiraProjectKey, issueTypeId };
    } catch (error) {
      warnings.push(describeJiraFailure(error));
    }
  }

  return {
    taskId: task.id,
    connection: {
      id: connection.id,
      baseUrl: connection.baseUrl,
      deployment,
    },
    tokenConnected: tokenRow !== null,
    target: {
      jiraProjectKey: mapping.jiraProjectKey,
      issueTypeId: mapping.issueTypeId,
      issueTypeName: mapping.issueTypeName,
    },
    link: link ? toLinkResponse(link) : null,
    fields,
    missingRequired,
    warnings,
    createMeta,
  };
}
