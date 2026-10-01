import type {
  JiraMetaComponent,
  JiraMetaField,
  JiraMetaIssueType,
  JiraMetaProject,
  JiraMetaStatus,
} from "@/fetchers/jira-integration/types";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import useGetWorkspaceCustomFields from "@/hooks/queries/custom-field/use-get-workspace-custom-fields";
import useGetJiraConnection from "@/hooks/queries/jira-integration/use-get-jira-connection";
import {
  useJiraComponents,
  useJiraCreateFields,
  useJiraIssueTypes,
  useJiraProjects,
  useJiraStatuses,
} from "@/hooks/queries/jira-integration/use-get-jira-meta";
import useGetJiraTokenStatus from "@/hooks/queries/jira-integration/use-get-jira-token-status";
import useGetWorkspaceMembers from "@/hooks/queries/workspace/use-get-workspace-members";
import type { MappingLevel } from "./mapping-model";

// Everything the mapping editor offers in its pickers. A list is `undefined`
// when it could not be read (no token, no connection, Jira down, the project
// key or issue type not known yet): the editor then falls back to typing the
// value.
export type JiraEditorData = {
  workspaceId: string;
  projectId?: string;
  level: MappingLevel;
  deployment?: "server" | "cloud";
  hasToken: boolean;
  projects?: JiraMetaProject[];
  issueTypes?: JiraMetaIssueType[];
  fields?: JiraMetaField[];
  statuses?: JiraMetaStatus[];
  components?: JiraMetaComponent[];
  customFields: { id: string; name: string }[];
  members: { id: string; label: string }[];
  columns?: { slug: string; name: string }[];
  // The project key used to search Jira users and read components.
  projectKey: string | null;
};

export function useJiraEditorData({
  level,
  workspaceId,
  projectId,
  projectKey,
  issueTypeId,
}: {
  level: MappingLevel;
  workspaceId: string;
  projectId?: string;
  projectKey: string | null;
  issueTypeId: string | null;
}): JiraEditorData {
  const { data: connection } = useGetJiraConnection(workspaceId);
  const { data: token } = useGetJiraTokenStatus(workspaceId);
  const hasToken = token?.connected === true && connection?.isActive === true;
  const meta = { enabled: hasToken };

  const projects = useJiraProjects(workspaceId, meta);
  const issueTypes = useJiraIssueTypes(workspaceId, projectKey, meta);
  const fields = useJiraCreateFields(
    workspaceId,
    projectKey,
    issueTypeId,
    meta,
  );
  const statuses = useJiraStatuses(workspaceId, projectKey, meta);
  const components = useJiraComponents(workspaceId, projectKey, meta);

  const workspaceFields = useGetWorkspaceCustomFields(
    level === "project" ? "" : workspaceId,
  );
  const projectFields = useGetCustomFieldsByProject(
    level === "project" ? (projectId ?? "") : "",
  );
  const customFields =
    (level === "project" ? projectFields.data : workspaceFields.data) ?? [];

  const { data: members } = useGetWorkspaceMembers({ workspaceId });
  const columns = useGetColumns(level === "project" ? (projectId ?? "") : "");

  return {
    workspaceId,
    projectId,
    level,
    deployment: connection?.deployment,
    hasToken,
    projects: projects.data?.projects,
    issueTypes: projectKey ? issueTypes.data?.issueTypes : undefined,
    fields: projectKey && issueTypeId ? fields.data?.fields : undefined,
    statuses: projectKey ? statuses.data?.statuses : undefined,
    components: projectKey ? components.data?.components : undefined,
    customFields: customFields.map((field) => ({
      id: field.id,
      name: field.name,
    })),
    members: (members ?? []).map((member) => ({
      id: member.userId,
      label: member.user.name || member.user.email || member.userId,
    })),
    columns:
      level === "project"
        ? columns.data?.map((column) => ({
            slug: column.slug,
            name: column.name,
          }))
        : undefined,
    projectKey,
  };
}
