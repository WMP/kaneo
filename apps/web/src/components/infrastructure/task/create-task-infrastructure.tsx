import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import useProjectHosts from "@/hooks/queries/infrastructure/use-project-hosts";
import useProjectModels from "@/hooks/queries/infrastructure/use-project-models";
import useProjectStorageClusters from "@/hooks/queries/infrastructure/use-project-storage-clusters";
import { VmListEditor } from "./vm-list-editor";
import type { VmRow } from "./vm-rows";

const NO_SAVED_VMS: never[] = [];

type Props = {
  projectId: string;
  rows: VmRow[];
  onChange: (update: (current: VmRow[]) => VmRow[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The user tried to create the task: show every field problem.
  showAllErrors: boolean;
  // The list was cleared because the project changed.
  showProjectChangedHint: boolean;
  hasInvalidRow: boolean;
};

// The "Infrastructure" section of the create task modal: the VMs the new task
// gets, edited with the same editor as in the task details. The rows are kept
// by the modal and written only after the task is saved. The caller renders it
// only for a project in which the user may plan infrastructure.
export function CreateTaskInfrastructure({
  projectId,
  rows,
  onChange,
  open,
  onOpenChange,
  showAllErrors,
  showProjectChangedHint,
  hasInvalidRow,
}: Props) {
  const { t } = useTranslation();
  const hostsQuery = useProjectHosts(projectId);
  const clustersQuery = useProjectStorageClusters(projectId);
  const modelsQuery = useProjectModels(projectId);

  // The editor sits inside the task form: Enter in a VM field must not create
  // the task, and the "New host" dialog (a portal, but a React child of the
  // form) must not submit the task form with its own form.
  const keepEnterInsideEditor = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      event.key === "Enter" &&
      target.tagName === "INPUT" &&
      event.currentTarget.contains(target)
    ) {
      event.preventDefault();
    }
  };

  return (
    <div className="mt-2" data-testid="create-task-infrastructure">
      <Accordion
        className="w-full"
        value={open ? ["infrastructure"] : []}
        onValueChange={(value) => onOpenChange(value.length > 0)}
      >
        <AccordionItem
          value="infrastructure"
          className="rounded-lg border border-border bg-sidebar/30 px-4"
        >
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="flex items-center gap-2 text-left">
              <span className="text-sm font-semibold text-foreground">
                {t("tasks:infrastructure.title")}
              </span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {rows.length}
              </span>
            </div>
          </AccordionTrigger>

          <AccordionContent className="pb-4">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops form submission bubbling from inside the editor. */}
            <div
              className="flex flex-col gap-3 border-t border-border pt-4"
              onKeyDown={keepEnterInsideEditor}
              onSubmit={(event) => event.stopPropagation()}
            >
              {showProjectChangedHint && rows.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("common:modals.createTask.infrastructureProjectChanged")}
                </p>
              )}
              <VmListEditor
                projectId={projectId}
                rows={rows}
                onChange={onChange}
                hosts={hostsQuery.data}
                hostsLoaded={hostsQuery.isSuccess}
                clusters={clustersQuery.data ?? []}
                models={modelsQuery.data ?? []}
                savedVms={NO_SAVED_VMS}
                canEdit
                showAllErrors={showAllErrors}
              />
              {showAllErrors && hasInvalidRow && (
                <p role="alert" className="text-xs text-destructive-foreground">
                  {t("common:modals.createTask.infrastructureInvalid")}
                </p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
