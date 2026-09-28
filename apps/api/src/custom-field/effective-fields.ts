import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  customFieldDefinitionTable,
  projectHiddenFieldTable,
  projectTable,
} from "../database/schema";

export type CustomFieldDefinitionRow =
  typeof customFieldDefinitionTable.$inferSelect;

export type EffectiveCustomFieldDefinition = CustomFieldDefinitionRow & {
  scope: "workspace" | "project";
  // true only for a workspace field that isn't required — a project can
  // never hide its own field, and a required workspace field is mandatory
  // everywhere it's inherited.
  hideable: boolean;
  hidden: boolean;
};

export function annotateCustomField(
  row: CustomFieldDefinitionRow,
  hidden = false,
): EffectiveCustomFieldDefinition {
  const scope: "workspace" | "project" = row.workspaceId
    ? "workspace"
    : "project";
  return {
    ...row,
    scope,
    hideable: scope === "workspace" && !row.required,
    hidden,
  };
}

export async function getProjectWorkspaceId(
  projectId: string,
): Promise<string> {
  const [project] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project.workspaceId;
}

/**
 * Pure merge of a project's inherited workspace fields with its own
 * project-level fields. Ordering: workspace fields first (by position
 * ascending), then project fields (by position ascending) — the two scales
 * are independent (a project's fields and its workspace's fields are
 * positioned separately), so this fixed grouping is the documented combined
 * order rather than an interleave by a shared "position".
 *
 * `includeHidden` false (the default — the EFFECTIVE set) drops every
 * workspace field this project hides and reports `hidden: false` on
 * everything returned. `includeHidden` true keeps every inherited workspace
 * field, annotated with its real per-project hidden state, for the
 * project's field-visibility editor; project-level fields are never
 * hideable so they're always `hidden: false` either way.
 */
export function mergeEffectiveFields(
  workspaceFields: CustomFieldDefinitionRow[],
  projectFields: CustomFieldDefinitionRow[],
  hiddenFieldIds: ReadonlySet<string>,
  includeHidden = false,
): EffectiveCustomFieldDefinition[] {
  const sortedWorkspaceFields = [...workspaceFields].sort(
    (a, b) => a.position - b.position,
  );
  const sortedProjectFields = [...projectFields].sort(
    (a, b) => a.position - b.position,
  );

  const workspaceResult: EffectiveCustomFieldDefinition[] = [];
  for (const field of sortedWorkspaceFields) {
    const hidden = hiddenFieldIds.has(field.id);
    if (hidden && !includeHidden) continue;
    workspaceResult.push(annotateCustomField(field, includeHidden && hidden));
  }

  const projectResult = sortedProjectFields.map((field) =>
    annotateCustomField(field, false),
  );

  return [...workspaceResult, ...projectResult];
}

async function loadProjectFieldScope(projectId: string) {
  const workspaceId = await getProjectWorkspaceId(projectId);

  const [workspaceFields, projectFields, hiddenRows] = await Promise.all([
    db
      .select()
      .from(customFieldDefinitionTable)
      .where(eq(customFieldDefinitionTable.workspaceId, workspaceId)),
    db
      .select()
      .from(customFieldDefinitionTable)
      .where(eq(customFieldDefinitionTable.projectId, projectId)),
    db
      .select({ fieldId: projectHiddenFieldTable.fieldId })
      .from(projectHiddenFieldTable)
      .where(eq(projectHiddenFieldTable.projectId, projectId)),
  ]);

  return {
    workspaceId,
    workspaceFields,
    projectFields,
    hiddenFieldIds: new Set(hiddenRows.map((row) => row.fieldId)),
  };
}

export async function getEffectiveCustomFieldDefinitions(
  projectId: string,
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Promise<EffectiveCustomFieldDefinition[]> {
  const { workspaceFields, projectFields, hiddenFieldIds } =
    await loadProjectFieldScope(projectId);

  return mergeEffectiveFields(
    workspaceFields,
    projectFields,
    hiddenFieldIds,
    includeHidden,
  );
}

// Field ids a task in this project may hold a value for: the project's own
// fields, plus its workspace's fields this project hasn't hidden. Used to
// scope value reads/writes and required-field enforcement so a hidden or
// foreign field never surfaces.
export async function getEffectiveFieldIdSet(
  projectId: string,
): Promise<Set<string>> {
  const fields = await getEffectiveCustomFieldDefinitions(projectId);
  return new Set(fields.map((field) => field.id));
}

export async function getEffectiveFieldDefinitionMap(
  projectId: string,
): Promise<Map<string, EffectiveCustomFieldDefinition>> {
  const fields = await getEffectiveCustomFieldDefinitions(projectId);
  return new Map(fields.map((field) => [field.id, field]));
}
