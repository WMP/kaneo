import { Link } from "@tanstack/react-router";
import { CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  useDeleteJiraToken,
  usePutJiraToken,
} from "@/hooks/mutations/jira-integration/use-jira-token";
import useGetJiraConnection from "@/hooks/queries/jira-integration/use-get-jira-connection";
import useGetJiraTokenStatus from "@/hooks/queries/jira-integration/use-get-jira-token-status";
import { getJiraErrorMessage } from "@/lib/jira-error";
import { toast } from "@/lib/toast";
import { ConfirmDialog } from "./confirm-dialog";

function formatTimestamp(value: string | null, locale: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

// The caller's own Jira token for one workspace. It is verified against Jira
// before it is stored and never shown again; only the Jira identity, the last
// verification and the last error are.
export function JiraTokenSettings({ workspaceId }: { workspaceId: string }) {
  const { t, i18n } = useTranslation();
  const { data: connection, isLoading: connectionLoading } =
    useGetJiraConnection(workspaceId);
  const {
    data: status,
    isLoading: statusLoading,
    error: statusError,
    refetch,
  } = useGetJiraTokenStatus(workspaceId);
  const putToken = usePutJiraToken();
  const deleteToken = useDeleteJiraToken();

  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (connectionLoading || statusLoading) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />;
  }

  if (statusError) {
    return (
      <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/25 bg-sidebar p-4">
        <p className="text-sm text-muted-foreground">
          {getJiraErrorMessage(
            statusError,
            t,
            "settings:jiraIntegration.token.loadError",
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => refetch()}
        >
          {t("settings:jiraIntegration.retry")}
        </Button>
      </div>
    );
  }

  if (!connection?.isActive) {
    return (
      <div className="space-y-1 rounded-md border border-border bg-sidebar p-4">
        <p className="text-sm font-medium">
          {t("settings:jiraIntegration.token.noConnectionTitle")}
        </p>
        <p className="text-xs text-muted-foreground">
          {connection
            ? t("settings:jiraIntegration.token.connectionInactive")
            : t("settings:jiraIntegration.token.noConnection")}{" "}
          <Link
            to="/dashboard/settings/workspace/jira"
            className="text-primary underline underline-offset-2"
          >
            {t("settings:jiraIntegration.token.workspaceLink")}
          </Link>
        </p>
      </div>
    );
  }

  const isCloud = connection.deployment === "cloud";
  const canSubmit =
    token.trim() !== "" &&
    (!isCloud || email.trim() !== "") &&
    !putToken.isPending;
  const verifiedAt = formatTimestamp(
    status?.lastVerifiedAt ?? null,
    i18n?.language,
  );
  const identity =
    status?.jiraDisplayName ?? status?.jiraUsername ?? status?.jiraAccountId;

  const handleSubmit = async () => {
    setFormError(null);
    try {
      await putToken.mutateAsync({
        workspaceId,
        data: {
          token: token.trim(),
          ...(isCloud ? { email: email.trim() } : {}),
        },
      });
      // The token is not kept in the page once it is stored.
      setToken("");
      toast.success(t("settings:jiraIntegration.token.saved"));
    } catch (error) {
      setFormError(
        getJiraErrorMessage(
          error,
          t,
          "settings:jiraIntegration.token.saveError",
        ),
      );
    }
  };

  const handleDelete = async () => {
    try {
      await deleteToken.mutateAsync(workspaceId);
      setToken("");
      setFormError(null);
      toast.success(t("settings:jiraIntegration.token.deleted"));
    } catch (error) {
      toast.error(
        getJiraErrorMessage(
          error,
          t,
          "settings:jiraIntegration.token.deleteError",
        ),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-sidebar p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {t("settings:jiraIntegration.token.status")}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {t("settings:jiraIntegration.token.instance", {
                url: connection.baseUrl,
              })}
            </p>
          </div>
          {status?.connected ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle />
              {t("settings:jiraIntegration.token.badgeConnected")}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <XCircle />
              {t("settings:jiraIntegration.token.badgeNotConnected")}
            </Badge>
          )}
        </div>

        {status?.connected && (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {identity && (
              <>
                <dt className="text-muted-foreground">
                  {t("settings:jiraIntegration.token.identity")}
                </dt>
                <dd className="break-all">
                  {identity}
                  {status.jiraUsername && status.jiraUsername !== identity
                    ? ` (${status.jiraUsername})`
                    : null}
                </dd>
              </>
            )}
            {status.email && (
              <>
                <dt className="text-muted-foreground">
                  {t("settings:jiraIntegration.token.email")}
                </dt>
                <dd className="break-all">{status.email}</dd>
              </>
            )}
            {verifiedAt && (
              <>
                <dt className="text-muted-foreground">
                  {t("settings:jiraIntegration.token.lastVerified")}
                </dt>
                <dd>{verifiedAt}</dd>
              </>
            )}
          </dl>
        )}

        {status?.lastError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground"
          >
            {t("settings:jiraIntegration.token.lastError", {
              message: status.lastError,
            })}
          </p>
        )}
      </div>

      <form
        className="space-y-4 rounded-md border border-border bg-sidebar p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void handleSubmit();
        }}
      >
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {status?.connected
              ? t("settings:jiraIntegration.token.replaceTitle")
              : t("settings:jiraIntegration.token.addTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {isCloud
              ? t("settings:jiraIntegration.token.cloudHint")
              : t("settings:jiraIntegration.token.serverHint")}
          </p>
        </div>

        {isCloud && (
          <Field>
            <FieldLabel>
              {t("settings:jiraIntegration.token.emailLabel")}
            </FieldLabel>
            <Input
              type="email"
              value={email}
              autoComplete="off"
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
            <FieldDescription>
              {t("settings:jiraIntegration.token.emailHint")}
            </FieldDescription>
          </Field>
        )}

        <Field>
          <FieldLabel>
            {isCloud
              ? t("settings:jiraIntegration.token.tokenLabelCloud")
              : t("settings:jiraIntegration.token.tokenLabelServer")}
          </FieldLabel>
          <Input
            type="password"
            value={token}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => setToken(event.target.value)}
          />
          <FieldDescription>
            {t("settings:jiraIntegration.token.tokenHint")}
          </FieldDescription>
        </Field>

        {formError && (
          <p role="alert" className="text-xs text-destructive-foreground">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {putToken.isPending
              ? t("settings:jiraIntegration.token.verifying")
              : t("settings:jiraIntegration.token.verifyAndSave")}
          </Button>
          {status?.connected && (
            <Button
              type="button"
              variant="destructive-outline"
              size="sm"
              disabled={deleteToken.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              {t("settings:jiraIntegration.token.delete")}
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("settings:jiraIntegration.token.deleteTitle")}
        description={t("settings:jiraIntegration.token.deleteDescription")}
        confirmLabel={t("settings:jiraIntegration.token.deleteConfirm")}
        pending={deleteToken.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
