import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import { useGetJiraResolvedMapping } from "@/hooks/queries/jira-integration/use-get-jira-mapping";
import useGetWorkspaceMembers from "@/hooks/queries/workspace/use-get-workspace-members";
import { getJiraErrorMessage } from "@/lib/jira-error";
import { OriginBadge } from "./mapping-controls";
import { useBuiltinLabels } from "./mapping-fields-section";

// Read-only result of merging default, workspace, project and the caller's own
// level, as the server resolves it for the caller's sends from this project.
export function ResolvedMappingPreview({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const builtinLabels = useBuiltinLabels();
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useGetJiraResolvedMapping(
    open ? projectId : undefined,
  );
  const { data: customFields } = useGetCustomFieldsByProject(
    open ? projectId : "",
  );
  const { data: columns } = useGetColumns(open ? projectId : "");
  const { data: members } = useGetWorkspaceMembers({
    workspaceId: open ? workspaceId : undefined,
  });

  const mapping = data?.mapping;

  const sourceLabel = (
    source: NonNullable<typeof mapping>["fieldMappings"][number]["source"],
  ) => {
    if (source.kind === "builtin") return builtinLabels[source.field];
    if (source.kind === "custom") {
      return (
        customFields?.find((field) => field.id === source.customFieldId)
          ?.name ?? source.customFieldId
      );
    }
    return t("settings:jiraIntegration.mapping.sourceNone");
  };

  return (
    <details
      className="rounded-md border border-border bg-sidebar"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {t("settings:jiraIntegration.project.effectiveTitle")}
      </summary>
      <div className="space-y-4 border-t border-border p-4 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("settings:jiraIntegration.project.effectiveDescription")}
        </p>
        {isLoading && <div className="h-16 animate-pulse rounded bg-muted" />}
        {error && (
          <p className="text-xs text-destructive-foreground">
            {getJiraErrorMessage(
              error,
              t,
              "settings:jiraIntegration.mapping.loadError",
            )}
          </p>
        )}
        {mapping && (
          <>
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">
                {t("settings:jiraIntegration.mapping.projectKey")}
              </dt>
              <dd className="flex flex-wrap items-center gap-2">
                {mapping.jiraProjectKey.value ?? "-"}
                {mapping.jiraProjectKey.value && (
                  <OriginBadge origin={mapping.jiraProjectKey.origin} />
                )}
              </dd>
              <dt className="text-muted-foreground">
                {t("settings:jiraIntegration.mapping.issueType")}
              </dt>
              <dd className="flex flex-wrap items-center gap-2">
                {mapping.issueTypeName.value ??
                  mapping.issueTypeId.value ??
                  "-"}
                {mapping.issueTypeId.value && (
                  <OriginBadge origin={mapping.issueTypeId.origin} />
                )}
              </dd>
              <dt className="text-muted-foreground">
                {t("settings:jiraIntegration.mapping.components")}
              </dt>
              <dd className="flex flex-wrap items-center gap-2">
                {mapping.components.value.length > 0
                  ? mapping.components.value.join(", ")
                  : "-"}
                {mapping.components.value.length > 0 && (
                  <OriginBadge origin={mapping.components.origin} />
                )}
              </dd>
            </dl>

            <PreviewList
              title={t("settings:jiraIntegration.mapping.fieldsTitle")}
              empty={t("settings:jiraIntegration.mapping.fieldsEmpty")}
              rows={mapping.fieldMappings.map((row) => ({
                key: row.target.fieldId,
                text: `${row.target.fieldName || row.target.fieldId} ← ${sourceLabel(row.source)}`,
                origin: row.origin,
              }))}
            />
            <PreviewList
              title={t("settings:jiraIntegration.mapping.statusesTitle")}
              empty={t("settings:jiraIntegration.mapping.statusesEmpty")}
              rows={mapping.statusMappings.map((row) => ({
                key: row.jiraStatusId ?? row.jiraStatusName,
                text: `${row.jiraStatusName} → ${
                  columns?.find((column) => column.slug === row.kaneoStatus)
                    ?.name ?? row.kaneoStatus
                }`,
                origin: row.origin,
              }))}
            />
            <PreviewList
              title={t("settings:jiraIntegration.mapping.usersTitle")}
              empty={t("settings:jiraIntegration.mapping.usersEmpty")}
              rows={mapping.userMappings.map((row) => {
                const member = members?.find(
                  (entry) => entry.userId === row.kaneoUserId,
                );
                return {
                  key: row.kaneoUserId,
                  text: `${member?.user.name || member?.user.email || row.kaneoUserId} → ${row.jiraUser}`,
                  origin: row.origin,
                };
              })}
            />
            <PreviewList
              title={t("settings:jiraIntegration.mapping.labelsTitle")}
              empty={t("settings:jiraIntegration.mapping.labelsEmpty")}
              rows={mapping.labelComponentMappings.map((row) => ({
                key: row.kaneoLabel,
                text: `${row.kaneoLabel} → ${row.jiraComponent}`,
                origin: row.origin,
              }))}
            />
          </>
        )}
      </div>
    </details>
  );
}

function PreviewList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: {
    key: string;
    text: string;
    origin: React.ComponentProps<typeof OriginBadge>["origin"];
  }[];
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-2">
              <span>{row.text}</span>
              <OriginBadge origin={row.origin} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
