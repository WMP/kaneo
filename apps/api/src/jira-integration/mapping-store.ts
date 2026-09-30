import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getEffectiveCustomFieldDefinitions } from "../custom-field/effective-fields";
import db from "../database";
import {
  customFieldDefinitionTable,
  jiraMappingTable,
  projectTable,
  workspaceUserTable,
} from "../database/schema";
import { getValidTaskStatuses } from "../task/validate-task-fields";
import { accessibleProjectIds } from "../utils/project-access";
import {
  type JiraMappingOrigin,
  type MappingLevels,
  type ResolvedJiraMapping,
  resolveJiraMapping,
} from "./mapping";
import { type JiraMappingConfig, jiraMappingConfigSchema } from "./schema";

export type MappingScope = Exclude<JiraMappingOrigin, "default">;

export type MappingKey =
  | { scope: "workspace"; workspaceId: string }
  | { scope: "project"; workspaceId: string; projectId: string }
  | { scope: "user"; workspaceId: string; userId: string };

export type StoredMapping = { config: JiraMappingConfig; updatedAt: Date };

function keyCondition(key: MappingKey) {
  return and(
    eq(jiraMappingTable.workspaceId, key.workspaceId),
    eq(jiraMappingTable.scope, key.scope),
    key.scope === "project"
      ? eq(jiraMappingTable.projectId, key.projectId)
      : isNull(jiraMappingTable.projectId),
    key.scope === "user"
      ? eq(jiraMappingTable.userId, key.userId)
      : isNull(jiraMappingTable.userId),
  );
}

export async function loadMapping(
  key: MappingKey,
): Promise<StoredMapping | null> {
  const [row] = await db
    .select()
    .from(jiraMappingTable)
    .where(keyCondition(key))
    .limit(1);
  if (!row) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(row.config);
  } catch {
    raw = null;
  }
  const parsed = jiraMappingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    // Never log the config: it can hold Jira user names.
    console.warn("Ignoring an invalid stored Jira mapping", {
      mappingId: row.id,
      scope: row.scope,
    });
    return { config: {}, updatedAt: row.updatedAt };
  }
  return { config: parsed.data, updatedAt: row.updatedAt };
}

export async function saveMapping(
  key: MappingKey,
  config: JiraMappingConfig,
  updatedBy: string,
): Promise<StoredMapping> {
  const values = {
    workspaceId: key.workspaceId,
    scope: key.scope,
    projectId: key.scope === "project" ? key.projectId : null,
    userId: key.scope === "user" ? key.userId : null,
    config: JSON.stringify(config),
    updatedBy,
  };

  const [row] = await db
    .insert(jiraMappingTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        jiraMappingTable.workspaceId,
        jiraMappingTable.scope,
        jiraMappingTable.projectId,
        jiraMappingTable.userId,
      ],
      set: {
        config: values.config,
        updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new HTTPException(500, { message: "Failed to save Jira mapping" });
  }
  return { config, updatedAt: row.updatedAt };
}

// The levels above `scope`, merged. The project level belongs to a task, so
// the user level's parent stops at the workspace.
export async function resolveParent(
  workspaceId: string,
  scope: MappingScope,
  projectId?: string,
): Promise<ResolvedJiraMapping> {
  const levels: MappingLevels = {};
  if (scope !== "workspace") {
    levels.workspace = (
      await loadMapping({ scope: "workspace", workspaceId })
    )?.config;
  }
  if (scope === "user" && projectId) {
    levels.project = (
      await loadMapping({ scope: "project", workspaceId, projectId })
    )?.config;
  }
  return resolveJiraMapping(levels);
}

export async function resolveMappingForUser({
  workspaceId,
  projectId,
  userId,
}: {
  workspaceId: string;
  projectId: string;
  userId: string;
}): Promise<ResolvedJiraMapping> {
  const [workspace, project, user] = await Promise.all([
    loadMapping({ scope: "workspace", workspaceId }),
    loadMapping({ scope: "project", workspaceId, projectId }),
    loadMapping({ scope: "user", workspaceId, userId }),
  ]);
  return resolveJiraMapping({
    workspace: workspace?.config,
    project: project?.config,
    user: user?.config,
  });
}

function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}

async function allowedCustomFieldIds(key: MappingKey): Promise<Set<string>> {
  if (key.scope === "project") {
    const fields = await getEffectiveCustomFieldDefinitions(key.projectId);
    return new Set(fields.map((field) => field.id));
  }

  const workspaceFields = await db
    .select({ id: customFieldDefinitionTable.id })
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.workspaceId, key.workspaceId));
  const ids = new Set(workspaceFields.map((field) => field.id));

  if (key.scope === "user") {
    // A user mapping applies to sends from every project the user can open.
    const projectIds = await accessibleProjectIds(key.userId, key.workspaceId);
    const projectFields = await db
      .select({
        id: customFieldDefinitionTable.id,
        projectId: customFieldDefinitionTable.projectId,
      })
      .from(customFieldDefinitionTable)
      .innerJoin(
        projectTable,
        eq(customFieldDefinitionTable.projectId, projectTable.id),
      )
      .where(eq(projectTable.workspaceId, key.workspaceId));
    const visible = projectIds === null ? null : new Set(projectIds);
    for (const field of projectFields) {
      if (
        visible === null ||
        (field.projectId && visible.has(field.projectId))
      ) {
        ids.add(field.id);
      }
    }
  }
  return ids;
}

// Checks what a mapping refers to. Statuses are project columns only at the
// project level; the workspace level only needs non-empty strings (its
// projects have different columns), and the user level has no statuses.
export async function validateMappingReferences(
  key: MappingKey,
  config: JiraMappingConfig,
): Promise<void> {
  if (key.scope === "user" && (config.statusMappings?.length ?? 0) > 0) {
    throw badRequest(
      "Status mappings cannot be set at the user level: a status proposal belongs to the task, not to a person.",
    );
  }

  // A user mapping names a Kaneo user: only members of this workspace. A
  // removal marker (`jiraUser: null`) is always accepted, so a mapping for
  // somebody who has left can still be cleaned up.
  const mappedUserIds = [
    ...new Set(
      (config.userMappings ?? [])
        .filter((mapping) => mapping.jiraUser !== null)
        .map((mapping) => mapping.kaneoUserId),
    ),
  ];
  if (mappedUserIds.length > 0) {
    const members = await db
      .select({ userId: workspaceUserTable.userId })
      .from(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.workspaceId, key.workspaceId),
          inArray(workspaceUserTable.userId, mappedUserIds),
        ),
      );
    const memberIds = new Set(members.map((member) => member.userId));
    for (const id of mappedUserIds) {
      if (!memberIds.has(id)) {
        throw badRequest(
          `User "${id}" is not a member of this workspace and cannot be mapped.`,
        );
      }
    }
  }

  const customFieldIds = new Set<string>();
  for (const mapping of config.fieldMappings ?? []) {
    if (mapping.source.kind === "custom") {
      customFieldIds.add(mapping.source.customFieldId);
    }
  }
  if (customFieldIds.size > 0) {
    const allowed = await allowedCustomFieldIds(key);
    for (const id of customFieldIds) {
      if (!allowed.has(id)) {
        throw badRequest(
          `Custom field "${id}" does not exist or is not available here.`,
        );
      }
    }
  }

  if (key.scope === "project") {
    const statuses = (config.statusMappings ?? [])
      .map((mapping) => mapping.kaneoStatus)
      .filter((status): status is string => status !== null);
    if (statuses.length > 0) {
      const valid = new Set(await getValidTaskStatuses(key.projectId));
      for (const status of statuses) {
        if (!valid.has(status)) {
          throw badRequest(
            `Invalid status "${status}". Valid statuses for this project: ${[...valid].join(", ")}`,
          );
        }
      }
    }
  }
}
