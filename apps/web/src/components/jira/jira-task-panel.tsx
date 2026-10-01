import { Link } from "@tanstack/react-router";
import { ChevronRight, ExternalLink, RefreshCw, Unlink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  JiraStatusProposal,
  JiraSyncHint,
} from "@/fetchers/jira-integration/types";
import {
  useAcceptJiraProposal,
  useRefreshJiraTask,
  useRejectJiraProposal,
  useUnlinkJiraTask,
} from "@/hooks/mutations/jira-integration/use-jira-task";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetJiraConnection from "@/hooks/queries/jira-integration/use-get-jira-connection";
import useGetJiraTask from "@/hooks/queries/jira-integration/use-get-jira-task";
import useGetJiraTokenStatus from "@/hooks/queries/jira-integration/use-get-jira-token-status";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { getStatusDisplayLabel } from "@/lib/i18n/domain";
import { getJiraErrorMessage } from "@/lib/jira-error";
import { formatJiraTimestamp, safeJiraUrl } from "@/lib/jira-format";
import { toast } from "@/lib/toast";
import { ConfirmDialog } from "./confirm-dialog";
import { JiraProposalCard } from "./jira-proposal-card";

function syncHintKey(sync: JiraSyncHint | null) {
  if (!sync) return null;
  if (!sync.pollingEnabled) return "tasks:jira.panel.sync.pollingOff" as const;
  if (sync.creatorTokenState === "missing") {
    return "tasks:jira.panel.sync.creatorTokenMissing" as const;
  }
  if (sync.creatorTokenState === "invalid") {
    return "tasks:jira.panel.sync.creatorTokenInvalid" as const;
  }
  return null;
}

function ProposalHistory({
  proposals,
  resolverName,
  statusLabel,
}: {
  proposals: JiraStatusProposal[];
  resolverName: (userId: string | null) => string;
  statusLabel: (slug: string) => string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (proposals.length === 0) return null;

  const stateLabel = {
    pending: t("tasks:jira.panel.history.state.pending"),
    accepted: t("tasks:jira.panel.history.state.accepted"),
    rejected: t("tasks:jira.panel.history.state.rejected"),
    superseded: t("tasks:jira.panel.history.state.superseded"),
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight
          className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {t("tasks:jira.panel.history.title", { total: proposals.length })}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="mt-2 space-y-2">
          {proposals.map((proposal) => (
            <li
              key={proposal.id}
              className="space-y-0.5 text-xs"
              data-testid="jira-history-entry"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span>
                  {proposal.fromStatusName ?? "-"} → {proposal.toStatusName}
                </span>
                <Badge variant="outline" size="sm">
                  {stateLabel[proposal.state]}
                </Badge>
              </div>
              {proposal.state === "accepted" && (
                <p className="text-muted-foreground">
                  {proposal.resolvedStatus
                    ? t("tasks:jira.panel.history.acceptedAs", {
                        name: resolverName(proposal.resolvedByUserId),
                        status: statusLabel(proposal.resolvedStatus),
                      })
                    : t("tasks:jira.panel.history.accepted", {
                        name: resolverName(proposal.resolvedByUserId),
                      })}
                </p>
              )}
              {proposal.state === "rejected" && (
                <p className="text-muted-foreground">
                  {t("tasks:jira.panel.history.rejectedBy", {
                    name: resolverName(proposal.resolvedByUserId),
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

// The Jira side of a task in its properties sidebar: the linked issue, its last
// known Jira status, and the status changes seen in Jira that nobody has
// accepted or rejected yet. It renders nothing for a task that never had any of
// this, so a workspace without Jira sees no change.
export function JiraTaskPanel({
  taskId,
  projectId,
  workspaceId,
}: {
  taskId: string;
  projectId: string;
  workspaceId: string;
}) {
  const { t, i18n } = useTranslation();
  const { data: connection } = useGetJiraConnection(workspaceId);
  const active = connection?.isActive === true;
  const { data: info } = useGetJiraTask(taskId, { enabled: active });
  const { data: token } = useGetJiraTokenStatus(
    active ? workspaceId : undefined,
  );
  const { data: columns = [] } = useGetColumns(projectId);
  const { data: members } = useProjectMembers(projectId);
  const { canUpdateTasks } = useProjectPermission(projectId);

  const refresh = useRefreshJiraTask();
  const unlink = useUnlinkJiraTask();
  const accept = useAcceptJiraProposal();
  const reject = useRejectJiraProposal();
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  if (!active || !info) return null;
  const { link, pendingProposal, proposals, sync } = info;
  if (!link && proposals.length === 0) return null;

  const canUpdate = canUpdateTasks();
  const issueUrl = safeJiraUrl(link?.issueUrl);
  const syncedAt = formatJiraTimestamp(link?.lastSyncedAt, i18n?.language);
  const syncHint = syncHintKey(sync);
  const hasToken = token?.connected === true;

  const statusLabel = (slug: string) =>
    getStatusDisplayLabel(
      slug,
      columns.find((column) => column.slug === slug)?.name,
    );
  const resolverName = (userId: string | null) =>
    (userId
      ? members?.members.find((member) => member.userId === userId)?.user?.name
      : null) || t("common:people.someone");
  const history = proposals.filter(
    (proposal) => proposal.id !== pendingProposal?.id,
  );

  const handleRefresh = async () => {
    try {
      const result = await refresh.mutateAsync(taskId);
      if (result.changed) {
        toast.info(t("tasks:jira.panel.refreshChanged"));
      } else {
        toast.success(t("tasks:jira.panel.refreshUnchanged"));
      }
    } catch (error) {
      toast.error(
        getJiraErrorMessage(error, t, "tasks:jira.panel.refreshError"),
      );
    }
  };

  const handleUnlink = async () => {
    try {
      await unlink.mutateAsync(taskId);
      toast.success(t("tasks:jira.panel.unlinked"));
    } catch (error) {
      toast.error(
        getJiraErrorMessage(error, t, "tasks:jira.panel.unlinkError"),
      );
    }
  };

  const handleAccept = async (
    proposalId: string,
    status: string | undefined,
  ) => {
    try {
      await accept.mutateAsync({ proposalId, taskId, projectId, status });
      toast.success(t("tasks:jira.panel.proposal.accepted"));
    } catch (error) {
      toast.error(
        getJiraErrorMessage(error, t, "tasks:jira.panel.proposal.acceptError"),
      );
    }
  };

  const handleReject = async (proposalId: string) => {
    try {
      await reject.mutateAsync({ proposalId, taskId });
      toast.success(t("tasks:jira.panel.proposal.rejected"));
    } catch (error) {
      toast.error(
        getJiraErrorMessage(error, t, "tasks:jira.panel.proposal.rejectError"),
      );
    }
  };

  return (
    <section
      aria-label={t("tasks:jira.panel.title")}
      className="space-y-3 rounded-md border border-border bg-background p-3"
      data-testid="jira-task-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground/70">
          {t("tasks:jira.panel.title")}
        </h3>
        {link &&
          (issueUrl ? (
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
            >
              {link.issueKey}
              <ExternalLink className="size-3" aria-hidden="true" />
              <span className="sr-only">
                {t("tasks:jira.panel.opensInNewTab")}
              </span>
            </a>
          ) : (
            <span className="text-xs font-semibold">{link.issueKey}</span>
          ))}
      </div>

      {link ? (
        <div className="space-y-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">
              {t("tasks:jira.panel.status")}
            </dt>
            <dd className="font-medium">
              {link.lastStatusName ?? t("tasks:jira.panel.statusUnknown")}
            </dd>
            <dt className="text-muted-foreground">
              {t("tasks:jira.panel.lastSync")}
            </dt>
            <dd>{syncedAt ?? t("tasks:jira.panel.neverSynced")}</dd>
          </dl>
          {link.syncError && (
            <p role="alert" className="text-xs text-destructive-foreground">
              {t("tasks:jira.panel.syncError", { message: link.syncError })}
            </p>
          )}
          {syncHint && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="jira-sync-hint"
            >
              {t(syncHint)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!hasToken || refresh.isPending}
              onClick={handleRefresh}
            >
              <RefreshCw />
              {refresh.isPending
                ? t("tasks:jira.panel.refreshing")
                : t("tasks:jira.panel.refresh")}
            </Button>
            {canUpdate && (
              <Button
                type="button"
                variant="destructive-outline"
                size="xs"
                disabled={unlink.isPending}
                onClick={() => setConfirmUnlink(true)}
              >
                <Unlink />
                {t("tasks:jira.panel.unlink")}
              </Button>
            )}
          </div>
          {token && !hasToken && (
            <p className="text-xs text-muted-foreground">
              {t("tasks:jira.panel.tokenNeeded")}{" "}
              <Link
                to="/dashboard/settings/account/jira"
                className="text-primary underline underline-offset-2"
              >
                {t("tasks:jira.panel.tokenLink")}
              </Link>
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("tasks:jira.panel.notLinked")}
        </p>
      )}

      {pendingProposal && (
        <JiraProposalCard
          // A new pending proposal starts without the previous one's choice.
          key={pendingProposal.id}
          proposal={pendingProposal}
          proposedLabel={
            pendingProposal.proposedStatus
              ? statusLabel(pendingProposal.proposedStatus)
              : null
          }
          statusOptions={columns.map((column) => ({
            slug: column.slug,
            name: getStatusDisplayLabel(column.slug, column.name),
          }))}
          canResolve={canUpdate}
          pending={accept.isPending || reject.isPending}
          onAccept={(status) => handleAccept(pendingProposal.id, status)}
          onReject={() => handleReject(pendingProposal.id)}
        />
      )}

      <ProposalHistory
        proposals={history}
        resolverName={resolverName}
        statusLabel={statusLabel}
      />

      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title={t("tasks:jira.panel.unlinkTitle")}
        description={t("tasks:jira.panel.unlinkDescription", {
          issueKey: link?.issueKey ?? "",
        })}
        confirmLabel={t("tasks:jira.panel.unlinkConfirm")}
        pending={unlink.isPending}
        onConfirm={handleUnlink}
      />
    </section>
  );
}
