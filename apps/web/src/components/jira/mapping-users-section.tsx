import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type {
  JiraMappingConfig,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import { JiraUserField } from "./jira-user-field";
import { SimpleSelect } from "./mapping-controls";
import {
  appendRow,
  disableUserRow,
  type MappingIssue,
  overrideUserRow,
  removeRow,
  updateRow,
  userRows,
} from "./mapping-model";
import {
  DisabledRow,
  InheritedRow,
  OwnRowFrame,
  SectionShell,
} from "./mapping-row";
import type { JiraEditorData } from "./use-jira-editor-data";

// Kaneo member -> Jira user (username on Server, account id on Cloud).
export function MappingUsersSection({
  config,
  parent,
  data,
  readOnly,
  issues,
  onChange,
}: {
  config: JiraMappingConfig;
  parent: ResolvedJiraMapping | undefined;
  data: JiraEditorData;
  readOnly: boolean;
  issues: MappingIssue[];
  onChange: (config: JiraMappingConfig) => void;
}) {
  const { t } = useTranslation();
  const rows = userRows(config, parent);
  const memberName = (id: string) =>
    data.members.find((member) => member.id === id)?.label ?? id;
  const memberOptions = data.members.map((member) => ({
    value: member.id,
    label: member.label,
  }));

  const issueText = (index: number): string | null => {
    const issue = issues.find(
      (entry) => entry.list === "userMappings" && entry.index === index,
    );
    if (!issue) return null;
    if (issue.code === "userKaneoRequired") {
      return t("settings:jiraIntegration.mapping.errors.userKaneoRequired");
    }
    if (issue.code === "userJiraRequired") {
      return t("settings:jiraIntegration.mapping.errors.userJiraRequired");
    }
    if (issue.code === "userDuplicate") {
      return t("settings:jiraIntegration.mapping.errors.userDuplicate");
    }
    return null;
  };

  return (
    <SectionShell
      title={t("settings:jiraIntegration.mapping.usersTitle")}
      description={t("settings:jiraIntegration.mapping.usersDescription")}
      actions={
        !readOnly && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              onChange(
                appendRow(config, "userMappings", {
                  kaneoUserId: "",
                  jiraUser: "",
                }),
              )
            }
          >
            <Plus />
            {t("settings:jiraIntegration.mapping.addUser")}
          </Button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:jiraIntegration.mapping.usersEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((entry) => {
            if (entry.kind === "inherited") {
              return (
                <InheritedRow
                  key={`inherited:${entry.key}`}
                  origin={entry.parent.origin}
                  readOnly={readOnly}
                  summary={
                    <span>
                      <span className="font-medium">
                        {memberName(entry.parent.kaneoUserId)}
                      </span>{" "}
                      <span aria-hidden="true">→</span> {entry.parent.jiraUser}
                    </span>
                  }
                  onOverride={() =>
                    onChange(overrideUserRow(config, entry.parent))
                  }
                  onDisable={() =>
                    onChange(disableUserRow(config, entry.parent))
                  }
                />
              );
            }
            if (entry.kind === "disabled") {
              return (
                <DisabledRow
                  key={`disabled:${entry.index}`}
                  readOnly={readOnly}
                  summary={
                    <span>
                      <span className="font-medium">
                        {memberName(entry.own.kaneoUserId)}
                      </span>{" "}
                      <span aria-hidden="true">→</span>{" "}
                      {entry.parent?.jiraUser ?? ""}
                    </span>
                  }
                  onRestore={() =>
                    onChange(removeRow(config, "userMappings", entry.index))
                  }
                />
              );
            }

            const row = entry.own;
            return (
              <OwnRowFrame
                key={`own:${entry.index}`}
                overrides={entry.overrides?.origin}
                invalid={issueText(entry.index)}
                readOnly={readOnly}
                onRemove={() =>
                  onChange(removeRow(config, "userMappings", entry.index))
                }
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.kaneoMember")}
                    </p>
                    <SimpleSelect
                      value={row.kaneoUserId}
                      options={memberOptions}
                      disabled={readOnly}
                      invalid={!row.kaneoUserId.trim()}
                      placeholder={t(
                        "settings:jiraIntegration.mapping.selectPlaceholder",
                      )}
                      ariaLabel={t(
                        "settings:jiraIntegration.mapping.kaneoMember",
                      )}
                      onChange={(id) =>
                        onChange(
                          updateRow(config, "userMappings", entry.index, {
                            kaneoUserId: id,
                          }),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.jiraUser")}
                    </p>
                    <JiraUserField
                      value={row.jiraUser ?? ""}
                      workspaceId={data.workspaceId}
                      deployment={data.deployment}
                      projectKey={data.projectKey}
                      searchEnabled={data.hasToken}
                      disabled={readOnly}
                      invalid={!row.jiraUser?.trim()}
                      onChange={(jiraUser) =>
                        onChange(
                          updateRow(config, "userMappings", entry.index, {
                            jiraUser,
                          }),
                        )
                      }
                    />
                  </div>
                </div>
              </OwnRowFrame>
            );
          })}
        </ul>
      )}
    </SectionShell>
  );
}
