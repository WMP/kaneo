import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { JiraStatusProposal } from "@/fetchers/jira-integration/types";
import { SimpleSelect } from "./mapping-controls";

export type StatusOption = { slug: string; name: string };

// A status change seen in Jira, waiting for a person to decide. The Kaneo
// status only changes when somebody with task:update accepts it. A Jira status
// that is not mapped carries no proposed status: whoever accepts picks one.
export function JiraProposalCard({
  proposal,
  proposedLabel,
  statusOptions,
  canResolve,
  pending,
  onAccept,
  onReject,
}: {
  proposal: JiraStatusProposal;
  // The proposed status as the person knows it (a column name).
  proposedLabel: string | null;
  statusOptions: StatusOption[];
  canResolve: boolean;
  pending: boolean;
  onAccept: (status: string | undefined) => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState("");
  const needsChoice = proposal.proposedStatus === null;
  const canAccept = !needsChoice || chosen !== "";

  return (
    <div
      className="space-y-2 rounded-md border border-warning/40 bg-warning/8 p-2.5"
      data-testid="jira-proposal"
    >
      <p className="text-xs font-medium">
        {proposal.fromStatusName
          ? t("tasks:jira.panel.proposal.changed", {
              from: proposal.fromStatusName,
              to: proposal.toStatusName,
            })
          : t("tasks:jira.panel.proposal.changedNoFrom", {
              to: proposal.toStatusName,
            })}
      </p>
      {needsChoice ? (
        <p className="text-xs text-muted-foreground">
          {t("tasks:jira.panel.proposal.unmapped")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("tasks:jira.panel.proposal.proposed", {
            status: proposedLabel ?? proposal.proposedStatus,
          })}
        </p>
      )}
      {proposal.jiraChangedBy && (
        <p className="text-xs text-muted-foreground">
          {t("tasks:jira.panel.proposal.changedBy", {
            name: proposal.jiraChangedBy,
          })}
        </p>
      )}

      {canResolve ? (
        <div className="space-y-2">
          {needsChoice && (
            <SimpleSelect
              value={chosen}
              onChange={setChosen}
              options={statusOptions.map((option) => ({
                value: option.slug,
                label: option.name,
              }))}
              placeholder={t("tasks:jira.panel.proposal.choosePlaceholder")}
              ariaLabel={t("tasks:jira.panel.proposal.chooseLabel")}
              disabled={pending}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="xs"
              disabled={pending || !canAccept}
              onClick={() => onAccept(needsChoice ? chosen : undefined)}
            >
              {t("tasks:jira.panel.proposal.accept")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={onReject}
            >
              {t("tasks:jira.panel.proposal.reject")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("tasks:jira.panel.proposal.waiting")}
        </p>
      )}
    </div>
  );
}
