import type {
  JiraComponent,
  JiraCreateField,
  JiraIssueType,
  JiraIssueTypeStatuses,
  JiraProject,
  JiraUser,
} from "./jira-client";

// Jira answers with far more than the pickers need; only these parts leave
// the API.
export function shapeProjects(projects: JiraProject[]) {
  return projects.map((project) => ({
    id: String(project.id),
    key: project.key,
    name: project.name,
  }));
}

export function shapeIssueTypes(issueTypes: JiraIssueType[]) {
  return issueTypes.map((type) => ({
    id: String(type.id),
    name: type.name,
    ...(type.subtask === undefined ? {} : { subtask: type.subtask }),
  }));
}

export function shapeFields(fields: JiraCreateField[]) {
  return fields.map((field) => ({
    fieldId: field.fieldId,
    name: field.name,
    required: field.required,
    hasDefaultValue: field.hasDefaultValue,
    schema: field.schema
      ? {
          type: field.schema.type,
          ...(field.schema.items ? { items: field.schema.items } : {}),
          ...(field.schema.system ? { system: field.schema.system } : {}),
          ...(field.schema.custom ? { custom: field.schema.custom } : {}),
        }
      : null,
    allowedValues: field.allowedValues
      ? field.allowedValues.map((value) => ({
          ...(value.id === undefined ? {} : { id: String(value.id) }),
          ...(typeof value.name === "string" ? { name: value.name } : {}),
          ...(typeof value.value === "string" ? { value: value.value } : {}),
        }))
      : null,
  }));
}

// A status appears once per issue type; the pickers want each one once.
export function shapeStatuses(issueTypes: JiraIssueTypeStatuses[]) {
  const unique = new Map<
    string,
    { id: string; name: string; category: string | null }
  >();
  for (const issueType of issueTypes) {
    for (const status of issueType.statuses ?? []) {
      const id = String(status.id);
      if (!unique.has(id)) {
        unique.set(id, {
          id,
          name: status.name,
          category: status.statusCategory?.key ?? null,
        });
      }
    }
  }
  return [...unique.values()];
}

export function shapeComponents(components: JiraComponent[]) {
  return components.map((component) => ({
    id: String(component.id),
    name: component.name,
  }));
}

export function shapeUsers(users: JiraUser[]) {
  return users
    .filter((user) => user.active !== false)
    .map((user) => ({
      name: user.name ?? null,
      accountId: user.accountId ?? null,
      displayName: user.displayName ?? null,
      emailAddress: user.emailAddress ?? null,
    }));
}
