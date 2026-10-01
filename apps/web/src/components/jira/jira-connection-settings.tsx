import { Link } from "@tanstack/react-router";
import {
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { JiraConnection } from "@/fetchers/jira-integration/types";
import {
  useDeleteJiraConnection,
  usePutJiraConnection,
  useRotateJiraWebhookSecret,
} from "@/hooks/mutations/jira-integration/use-jira-connection";
import useGetJiraConnection from "@/hooks/queries/jira-integration/use-get-jira-connection";
import { getJiraErrorMessage } from "@/lib/jira-error";
import { toast } from "@/lib/toast";
import { ConfirmDialog } from "./confirm-dialog";
import { SimpleSelect } from "./mapping-controls";

type Deployment = "server" | "cloud";

// The workspace's Jira connection: base URL, deployment, flags, and, for a
// manager, the webhook URL and secret. Everybody in the workspace may read the
// non-secret part; the API decides what a caller gets and may change.
export function JiraConnectionSettings({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const {
    data: connection,
    isLoading,
    error,
    refetch,
  } = useGetJiraConnection(workspaceId);

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />;
  }

  if (error) {
    return (
      <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/25 bg-sidebar p-4">
        <p className="text-sm text-muted-foreground">
          {getJiraErrorMessage(
            error,
            t,
            "settings:jiraIntegration.connection.loadError",
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

  return (
    <ConnectionForm
      // A saved connection replaces the form state.
      key={connection?.updatedAt ?? "none"}
      workspaceId={workspaceId}
      connection={connection ?? null}
      canManage={canManage}
    />
  );
}

function ConnectionForm({
  workspaceId,
  connection,
  canManage,
}: {
  workspaceId: string;
  connection: JiraConnection | null;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");
  const [deployment, setDeployment] = useState<Deployment>(
    connection?.deployment ?? "server",
  );
  const [isActive, setIsActive] = useState(connection?.isActive ?? true);
  const [pollingEnabled, setPollingEnabled] = useState(
    connection?.pollingEnabled ?? true,
  );
  const [showSecret, setShowSecret] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "rotate" | null>(null);

  const save = usePutJiraConnection();
  const rotate = useRotateJiraWebhookSecret();
  const remove = useDeleteJiraConnection();

  const changesCredentialTarget =
    connection !== null &&
    (baseUrl.trim() !== connection.baseUrl ||
      deployment !== connection.deployment);
  const dirty =
    connection === null ||
    baseUrl.trim() !== connection.baseUrl ||
    deployment !== connection.deployment ||
    isActive !== connection.isActive ||
    pollingEnabled !== connection.pollingEnabled;

  const disabled = !canManage;

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        workspaceId,
        data: { baseUrl: baseUrl.trim(), deployment, isActive, pollingEnabled },
      });
      toast.success(t("settings:jiraIntegration.connection.saved"));
    } catch (error) {
      toast.error(
        getJiraErrorMessage(
          error,
          t,
          "settings:jiraIntegration.connection.saveError",
        ),
      );
    }
  };

  const handleCopy = async (value: string, successKey: "url" | "secret") => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(
        successKey === "url"
          ? t("settings:jiraIntegration.connection.urlCopied")
          : t("settings:jiraIntegration.connection.secretCopied"),
      );
    } catch {
      toast.error(t("settings:jiraIntegration.connection.copyError"));
    }
  };

  const handleRotate = async () => {
    try {
      await rotate.mutateAsync(workspaceId);
      setShowSecret(false);
      toast.success(t("settings:jiraIntegration.connection.rotated"));
    } catch (error) {
      toast.error(
        getJiraErrorMessage(
          error,
          t,
          "settings:jiraIntegration.connection.rotateError",
        ),
      );
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync(workspaceId);
      toast.success(t("settings:jiraIntegration.connection.deleted"));
    } catch (error) {
      toast.error(
        getJiraErrorMessage(
          error,
          t,
          "settings:jiraIntegration.connection.deleteError",
        ),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-md border border-border bg-sidebar p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {t("settings:jiraIntegration.connection.status")}
            </p>
            <p className="text-xs text-muted-foreground">
              {connection
                ? connection.isActive
                  ? t("settings:jiraIntegration.connection.statusActive")
                  : t("settings:jiraIntegration.connection.statusInactive")
                : canManage
                  ? t("settings:jiraIntegration.connection.statusNone")
                  : t("settings:jiraIntegration.connection.statusNoneMember")}
            </p>
          </div>
          {connection?.isActive ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle />
              {t("settings:jiraIntegration.connection.badgeConnected")}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <XCircle />
              {t("settings:jiraIntegration.connection.badgeNotConnected")}
            </Badge>
          )}
        </div>

        {(canManage || connection) && (
          <>
            <Separator />
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canManage && dirty && baseUrl.trim()) void handleSave();
              }}
            >
              <Field>
                <FieldLabel>
                  {t("settings:jiraIntegration.connection.baseUrl")}
                </FieldLabel>
                <Input
                  value={baseUrl}
                  disabled={disabled}
                  placeholder="https://jira.example.com"
                  autoComplete="off"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
                <FieldDescription>
                  {t("settings:jiraIntegration.connection.baseUrlHint")}
                </FieldDescription>
              </Field>

              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("settings:jiraIntegration.connection.deployment")}
                </p>
                <SimpleSelect
                  value={deployment}
                  disabled={disabled}
                  className="sm:max-w-xs"
                  placeholder={t(
                    "settings:jiraIntegration.mapping.selectPlaceholder",
                  )}
                  ariaLabel={t(
                    "settings:jiraIntegration.connection.deployment",
                  )}
                  options={[
                    {
                      value: "server",
                      label: t(
                        "settings:jiraIntegration.connection.deploymentServer",
                      ),
                    },
                    {
                      value: "cloud",
                      label: t(
                        "settings:jiraIntegration.connection.deploymentCloud",
                      ),
                    },
                  ]}
                  onChange={(value) => setDeployment(value as Deployment)}
                />
                <p className="text-xs text-muted-foreground">
                  {deployment === "cloud"
                    ? t(
                        "settings:jiraIntegration.connection.deploymentCloudHint",
                      )
                    : t(
                        "settings:jiraIntegration.connection.deploymentServerHint",
                      )}
                </p>
              </div>

              {changesCredentialTarget && (
                <p
                  role="alert"
                  className="rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground"
                >
                  {t(
                    "settings:jiraIntegration.connection.tokensRemovedWarning",
                  )}
                </p>
              )}

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium" id="jira-active-label">
                    {t("settings:jiraIntegration.connection.active")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings:jiraIntegration.connection.activeHint")}
                  </p>
                </div>
                <Switch
                  checked={isActive}
                  disabled={disabled}
                  aria-labelledby="jira-active-label"
                  onCheckedChange={setIsActive}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium" id="jira-polling-label">
                    {t("settings:jiraIntegration.connection.polling")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings:jiraIntegration.connection.pollingHint")}
                  </p>
                </div>
                <Switch
                  checked={pollingEnabled}
                  disabled={disabled}
                  aria-labelledby="jira-polling-label"
                  onCheckedChange={setPollingEnabled}
                />
              </div>

              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!dirty || !baseUrl.trim() || save.isPending}
                  >
                    {connection
                      ? t("settings:jiraIntegration.connection.save")
                      : t("settings:jiraIntegration.connection.create")}
                  </Button>
                  {connection && (
                    <Button
                      type="button"
                      variant="destructive-outline"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => setConfirm("delete")}
                    >
                      {t("settings:jiraIntegration.connection.delete")}
                    </Button>
                  )}
                </div>
              )}
            </form>
          </>
        )}
      </div>

      {connection?.webhookUrl && (
        <div className="space-y-3 rounded-md border border-border bg-sidebar p-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {t("settings:jiraIntegration.connection.webhookTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings:jiraIntegration.connection.webhookHint")}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {t("settings:jiraIntegration.connection.webhookUrl")}
            </p>
            <div className="flex items-start gap-2">
              <code className="block flex-1 break-all rounded bg-muted px-2 py-1 text-[11px]">
                {connection.webhookUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t("settings:jiraIntegration.connection.copyUrl")}
                onClick={() => handleCopy(connection.webhookUrl ?? "", "url")}
              >
                <Copy />
              </Button>
            </div>
          </div>

          {connection.webhookSecret && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("settings:jiraIntegration.connection.webhookSecret")}
              </p>
              <div className="flex items-start gap-2">
                <code className="block flex-1 break-all rounded bg-muted px-2 py-1 text-[11px]">
                  {showSecret
                    ? connection.webhookSecret
                    : "••••••••••••••••••••••••••••••••"}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={
                    showSecret
                      ? t("settings:jiraIntegration.connection.hideSecret")
                      : t("settings:jiraIntegration.connection.showSecret")
                  }
                  aria-pressed={showSecret}
                  onClick={() => setShowSecret((current) => !current)}
                >
                  {showSecret ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t(
                    "settings:jiraIntegration.connection.copySecret",
                  )}
                  onClick={() =>
                    handleCopy(connection.webhookSecret ?? "", "secret")
                  }
                >
                  <Copy />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rotate.isPending}
                  onClick={() => setConfirm("rotate")}
                >
                  <RefreshCw />
                  {t("settings:jiraIntegration.connection.rotate")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings:jiraIntegration.connection.webhookSecretHint")}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("settings:jiraIntegration.connection.tokenIsPersonal")}{" "}
        <Link
          to="/dashboard/settings/account/jira"
          className="text-primary underline underline-offset-2"
        >
          {t("settings:jiraIntegration.connection.tokenIsPersonalLink")}
        </Link>
      </p>

      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("settings:jiraIntegration.connection.deleteTitle")}
        description={t("settings:jiraIntegration.connection.deleteDescription")}
        confirmLabel={t("settings:jiraIntegration.connection.deleteConfirm")}
        pending={remove.isPending}
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("settings:jiraIntegration.connection.rotateTitle")}
        description={t("settings:jiraIntegration.connection.rotateDescription")}
        confirmLabel={t("settings:jiraIntegration.connection.rotateConfirm")}
        pending={rotate.isPending}
        onConfirm={handleRotate}
      />
    </div>
  );
}
