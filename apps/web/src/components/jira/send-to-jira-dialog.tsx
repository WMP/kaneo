import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  JiraDraftWarning,
  JiraSendRequest,
} from "@/fetchers/jira-integration/types";
import { useSendTaskToJira } from "@/hooks/mutations/jira-integration/use-jira-task";
import useGetJiraDraft from "@/hooks/queries/jira-integration/use-get-jira-draft";
import {
  useJiraIssueTypes,
  useJiraProjects,
} from "@/hooks/queries/jira-integration/use-get-jira-meta";
import { getJiraErrorMessage, getJiraFieldErrors } from "@/lib/jira-error";
import { safeJiraUrl } from "@/lib/jira-format";
import { toast } from "@/lib/toast";
import { SimpleSelect } from "./mapping-controls";
import { DraftFieldRow } from "./send-to-jira-field-row";
import {
  buildSendFields,
  currentValue,
  type DraftEdits,
  type DraftValue,
  findEmptyRequiredFields,
} from "./send-to-jira-model";

// A typed value (a project key, an issue type id) that only takes effect when
// the person leaves the field: each change re-reads the draft from Jira.
function CommitInput({
  value,
  onCommit,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const commit = () => {
    const next = text.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      size="sm"
      value={text}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

// The API's warnings are English text for people reading a response. A
// missing token has its own message above and a missing target is translated;
// anything else (a Jira failure, a value that does not fit) is shown as sent.
function useWarningText() {
  const { t } = useTranslation();
  return (warning: JiraDraftWarning) =>
    warning.code === "JIRA_TARGET_MISSING"
      ? t("tasks:jira.send.warnings.targetMissing")
      : warning.message;
}

function SendToJiraDialogBody({
  taskId,
  workspaceId,
  onClose,
}: {
  taskId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const warningText = useWarningText();
  const send = useSendTaskToJira();

  // What the person changed: the Jira target (null until they pick another)
  // and the value of rows they edited. Both survive a re-read of the draft, so
  // a value stays for every field the new draft still has.
  const [target, setTarget] = useState<{
    projectKey: string;
    issueTypeId: string;
  } | null>(null);
  const [edits, setEdits] = useState<DraftEdits>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Both parts are needed to read another target's metadata; with only a
  // project picked the rows stay as they are until an issue type follows.
  const draftQuery = useGetJiraDraft(
    taskId,
    target?.projectKey && target.issueTypeId
      ? {
          jiraProjectKey: target.projectKey,
          issueTypeId: target.issueTypeId,
        }
      : {},
  );
  const draft = draftQuery.data;
  const linked = draft?.link ?? null;
  const tokenConnected = draft?.tokenConnected === true;

  const projectKey =
    target?.projectKey ?? draft?.target.jiraProjectKey.value ?? "";
  const issueTypeId =
    target?.issueTypeId ?? draft?.target.issueTypeId.value ?? "";

  const meta = { enabled: tokenConnected && !linked };
  const projects = useJiraProjects(workspaceId, meta);
  const issueTypes = useJiraIssueTypes(workspaceId, projectKey, meta);

  if (draftQuery.isPending) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("tasks:jira.send.title")}</DialogTitle>
          <DialogDescription>{t("tasks:jira.send.loading")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="h-32 animate-pulse rounded-md bg-muted" />
        </DialogPanel>
      </>
    );
  }

  if (!draft) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("tasks:jira.send.title")}</DialogTitle>
          <DialogDescription>
            {getJiraErrorMessage(
              draftQuery.error,
              t,
              "tasks:jira.send.loadError",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button size="sm" onClick={() => draftQuery.refetch()}>
            {t("tasks:jira.send.retry")}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const title = linked
    ? t("tasks:jira.send.titleUpdate")
    : t("tasks:jira.send.title");

  if (!tokenConnected) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t("tasks:jira.send.noToken.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="sm"
            render={<Link to="/dashboard/settings/account/jira" />}
            onClick={onClose}
          >
            {t("tasks:jira.send.noToken.link")}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const fieldIds = draft.fields.map((field) => field.fieldId);
  const emptyRequired = linked
    ? []
    : findEmptyRequiredFields(draft.fields, edits);
  // A required field of Jira that has no row at all cannot be filled here.
  const unmappedRequired = linked
    ? []
    : draft.missingRequired.filter((entry) => !entry.mapped);
  const warnings = draft.warnings.filter(
    (warning) => warning.code !== "JIRA_TOKEN_MISSING",
  );

  const hasTarget =
    linked !== null || (projectKey !== "" && issueTypeId !== "");
  const canSend =
    hasTarget &&
    emptyRequired.length === 0 &&
    !draftQuery.isPlaceholderData &&
    !send.isPending;

  const editField = (fieldId: string, value: DraftValue) => {
    setEdits((previous) => ({ ...previous, [fieldId]: value }));
    setFieldErrors(({ [fieldId]: _removed, ...rest }) => rest);
  };

  const handleSend = async () => {
    setSubmitError(null);
    setFieldErrors({});
    const data: JiraSendRequest = {
      ...(linked ? {} : { jiraProjectKey: projectKey, issueTypeId }),
      fields: buildSendFields(draft.fields, edits),
    };
    try {
      const result = await send.mutateAsync({ taskId, data });
      const issueUrl = safeJiraUrl(result.link.issueUrl);
      const message = result.created
        ? t("tasks:jira.send.createdToast", { issueKey: result.link.issueKey })
        : t("tasks:jira.send.updatedToast", { issueKey: result.link.issueKey });
      const warning = result.warnings[0]?.message;
      const options = {
        ...(warning ? { description: warning } : {}),
        ...(issueUrl
          ? {
              action: {
                label: result.link.issueKey,
                onClick: () =>
                  window.open(issueUrl, "_blank", "noopener,noreferrer"),
              },
            }
          : {}),
      };
      if (warning) toast.warning(message, options);
      else toast.success(message, options);
      onClose();
    } catch (error) {
      // Jira's message about a field goes under that field; the rest (and a
      // translated reason for the coded failures) goes in the alert.
      setFieldErrors(getJiraFieldErrors(error, fieldIds));
      setSubmitError(
        getJiraErrorMessage(error, t, "tasks:jira.send.error", {
          excludeFieldIds: fieldIds,
        }),
      );
    }
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) void handleSend();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {linked
            ? t("tasks:jira.send.descriptionUpdate", {
                issueKey: linked.issueKey,
              })
            : t("tasks:jira.send.description")}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="space-y-4">
        {submitError && (
          <Alert variant="error">
            <AlertTitle>{t("tasks:jira.send.errorTitle")}</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        {emptyRequired.length > 0 && (
          <Alert variant="warning" data-testid="jira-required-alert">
            <AlertTitle>
              {t("tasks:jira.send.missingRequired.title")}
            </AlertTitle>
            <AlertDescription>
              {emptyRequired.map((field) => field.fieldName).join(", ")}
            </AlertDescription>
          </Alert>
        )}

        {unmappedRequired.length > 0 && (
          <Alert variant="warning" data-testid="jira-unmapped-alert">
            <AlertTitle>{t("tasks:jira.send.unmapped.title")}</AlertTitle>
            <AlertDescription>
              {t("tasks:jira.send.unmapped.description", {
                fields: unmappedRequired.map((entry) => entry.name).join(", "),
              })}
            </AlertDescription>
          </Alert>
        )}

        {warnings.length > 0 && (
          <Alert variant="warning" data-testid="jira-warnings">
            <AlertTitle>{t("tasks:jira.send.warnings.title")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {warnings.map((warning) => (
                  <li key={`${warning.code}:${warning.message}`}>
                    {warningText(warning)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {linked ? (
          <p className="text-sm text-muted-foreground">
            {t("tasks:jira.send.linkedTo", { issueKey: linked.issueKey })}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                {t("tasks:jira.send.project")}
              </span>
              {projects.data ? (
                <SimpleSelect
                  value={projectKey}
                  onChange={(key) =>
                    setTarget({ projectKey: key, issueTypeId: "" })
                  }
                  options={projects.data.projects.map((project) => ({
                    value: project.key,
                    label: `${project.key} - ${project.name}`,
                  }))}
                  placeholder={t("tasks:jira.send.projectPlaceholder")}
                  ariaLabel={t("tasks:jira.send.project")}
                />
              ) : (
                <CommitInput
                  value={projectKey}
                  ariaLabel={t("tasks:jira.send.project")}
                  placeholder={t("tasks:jira.send.projectPlaceholder")}
                  onCommit={(key) =>
                    setTarget({ projectKey: key, issueTypeId: "" })
                  }
                />
              )}
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                {t("tasks:jira.send.issueType")}
              </span>
              {issueTypes.data ? (
                <SimpleSelect
                  value={issueTypeId}
                  onChange={(id) => setTarget({ projectKey, issueTypeId: id })}
                  options={issueTypes.data.issueTypes.map((issueType) => ({
                    value: issueType.id,
                    label: issueType.name,
                  }))}
                  placeholder={t("tasks:jira.send.issueTypePlaceholder")}
                  ariaLabel={t("tasks:jira.send.issueType")}
                />
              ) : (
                <CommitInput
                  key={projectKey}
                  value={issueTypeId}
                  ariaLabel={t("tasks:jira.send.issueType")}
                  placeholder={t("tasks:jira.send.issueTypePlaceholder")}
                  onCommit={(id) => setTarget({ projectKey, issueTypeId: id })}
                />
              )}
            </div>
          </div>
        )}

        <div className="space-y-2" aria-busy={draftQuery.isPlaceholderData}>
          <p className="text-sm font-medium">{t("tasks:jira.send.fields")}</p>
          {draft.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("tasks:jira.send.noFields")}
            </p>
          ) : (
            draft.fields.map((field) => (
              <DraftFieldRow
                key={field.fieldId}
                field={field}
                value={currentValue(field, edits)}
                edited={Object.hasOwn(edits, field.fieldId)}
                error={fieldErrors[field.fieldId]}
                context={{
                  workspaceId,
                  deployment: draft.connection.deployment,
                  projectKey: projectKey || null,
                  canSearchUsers: tokenConnected,
                }}
                onChange={(value) => editField(field.fieldId, value)}
              />
            ))
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!canSend}>
          {send.isPending
            ? t("tasks:jira.send.sending")
            : linked
              ? t("tasks:jira.send.submitUpdate")
              : t("tasks:jira.send.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Review and send: every field the mapping produces, with where its value comes
// from, editable before anything reaches Jira. The body mounts only while the
// dialog is open, so each opening reads a fresh draft and starts without edits.
export function SendToJiraDialog({
  open,
  onOpenChange,
  taskId,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  workspaceId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <SendToJiraDialogBody
          taskId={taskId}
          workspaceId={workspaceId}
          onClose={() => onOpenChange(false)}
        />
      </DialogPopup>
    </Dialog>
  );
}
