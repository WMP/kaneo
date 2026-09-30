import { Check, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useCreateResource from "@/hooks/mutations/resource/use-create-resource";
import { getResourceErrorMessage } from "@/lib/resource-error";
import { getResourceKindIcon } from "@/lib/resource-kind-icon";
import { toast } from "@/lib/toast";
import type Resource from "@/types/resource";
import type { ResourceKind } from "@/types/resource";

const RESOURCE_KINDS: ResourceKind[] = ["person", "equipment", "material"];

/**
 * The resources the picker offers. A resource linked to an account is that
 * account, so it is left out where the account is listed as a person (a member
 * of the project) - the person is picked there. Where the account is not a
 * project member the resource stays, so the person can still be assigned. A
 * resource that is on the task (`assignedResourceIds`: what the task really
 * has, not what was toggled in the open popover) always stays, so it can be
 * removed and a toggle never makes a row vanish under the pointer.
 */
export function getPickableResources(
  resources: Resource[],
  projectUserIds: ReadonlySet<string>,
  assignedResourceIds: ReadonlySet<string>,
): Resource[] {
  return resources.filter(
    (resource) =>
      !resource.userId ||
      !projectUserIds.has(resource.userId) ||
      assignedResourceIds.has(resource.id),
  );
}

type AssigneeResourceSectionProps = {
  workspaceId: string;
  resources: Resource[];
  /** The people listed next to the resources (the project's members). */
  projectUserIds: string[];
  /** The resources the task has now; none for a task that is being created. */
  assignedResourceIds?: string[];
  selectedResourceIds: string[];
  onToggleResource: (resourceId: string) => void;
  /** Whether the signed-in member may create a new workspace resource
   * inline from this popover (mirrors the API's project:update gate on
   * POST /resource — the same permission that manages workspace labels
   * and custom fields). */
  canCreateResource: boolean;
};

/** The resource half of the assignee picker: workspace resources (people,
 * equipment, material) grouped by kind, each toggleable like a user, plus
 * an inline "New resource" form so a resource never has to be created from
 * a separate settings page first. Shared by the task assignee popover and
 * the create-task modal. */
export function AssigneeResourceSection({
  workspaceId,
  resources,
  projectUserIds,
  assignedResourceIds,
  selectedResourceIds,
  onToggleResource,
  canCreateResource,
}: AssigneeResourceSectionProps) {
  const { t } = useTranslation();
  const { mutateAsync: createResource, isPending: creating } =
    useCreateResource();

  const everSelected = useRef<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("person");
  const [email, setEmail] = useState("");

  const groupedResources = useMemo(() => {
    // What the task has, and every resource that was selected while this
    // section was open: a toggle never makes a row vanish (deselecting keeps
    // it, so it can be selected again).
    for (const id of selectedResourceIds) everSelected.current.add(id);
    const pickable = getPickableResources(
      resources,
      new Set(projectUserIds),
      new Set([...(assignedResourceIds ?? []), ...everSelected.current]),
    );
    return RESOURCE_KINDS.map((resourceKind) => ({
      kind: resourceKind,
      items: pickable.filter((resource) => resource.kind === resourceKind),
    })).filter((group) => group.items.length > 0);
  }, [resources, projectUserIds, assignedResourceIds, selectedResourceIds]);

  const resetForm = () => {
    setName("");
    setKind("person");
    setEmail("");
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    try {
      const created = await createResource({
        workspaceId,
        kind,
        name: trimmedName,
        // Only a person has an email.
        email: kind === "person" ? email.trim() || undefined : undefined,
      });
      onToggleResource(created.id);
      setFormOpen(false);
      resetForm();
    } catch (error) {
      toast.error(
        getResourceErrorMessage(
          error,
          t,
          "tasks:popover.assignee.createResourceError",
        ),
      );
    }
  };

  return (
    <div className="space-y-1">
      {groupedResources.length > 0 && (
        <div className="space-y-0.5 pt-1">
          <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("tasks:popover.assignee.resourcesHeading")}
          </div>
          {groupedResources.map((group) => {
            const KindIcon = getResourceKindIcon(group.kind);
            return (
              <div key={group.kind}>
                {group.items.map((resource) => {
                  const isSelected = selectedResourceIds.includes(resource.id);
                  return (
                    <Button
                      key={resource.id}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 h-8 px-2"
                      onClick={() => onToggleResource(resource.id)}
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/30 bg-muted">
                        {KindIcon ? (
                          <KindIcon
                            className="size-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {resource.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="text-sm truncate">{resource.name}</span>
                      {isSelected && (
                        <Check className="ml-auto h-4 w-4 shrink-0" />
                      )}
                    </Button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {canCreateResource && (
        <div className="border-t border-border pt-1">
          {!formOpen ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2 text-muted-foreground"
              onClick={() => setFormOpen(true)}
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm">
                {t("tasks:popover.assignee.addResource")}
              </span>
            </Button>
          ) : (
            <div className="space-y-2 px-2 py-1.5">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(
                  "tasks:popover.assignee.newResourceNamePlaceholder",
                )}
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !creating) handleCreate();
                  if (e.key === "Escape") {
                    setFormOpen(false);
                    resetForm();
                  }
                }}
              />
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as ResourceKind)}
              >
                <SelectTrigger size="sm" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_KINDS.map((resourceKind) => (
                    <SelectItem key={resourceKind} value={resourceKind}>
                      {t(`tasks:popover.assignee.resourceKind.${resourceKind}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {kind === "person" && (
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t(
                    "tasks:popover.assignee.newResourceEmailPlaceholder",
                  )}
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creating) handleCreate();
                  }}
                />
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  disabled={!name.trim() || creating}
                  onClick={handleCreate}
                >
                  {t("tasks:popover.assignee.createResource")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                >
                  {t("common:actions.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AssigneeResourceSection;
