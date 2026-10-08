import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Shown by the project views while the project's tasks have not arrived yet,
// so a request in flight is never mistaken for a project without tasks (the
// "no scheduled tasks" empty state), and when that request failed.
export function TasksLoading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center gap-2 px-6 text-sm text-muted-foreground"
    >
      <Spinner aria-hidden="true" role="presentation" className="size-4" />
      <span>{t("tasks:loadState.loading")}</span>
    </div>
  );
}

export function TasksLoadError({
  onRetry,
  isRetrying = false,
}: {
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div role="alert" className="max-w-sm text-center">
        <h2 className="text-sm font-semibold text-foreground">
          {t("tasks:loadState.error")}
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={isRetrying}
          onClick={onRetry}
        >
          {t("tasks:loadState.retry")}
        </Button>
      </div>
    </div>
  );
}
