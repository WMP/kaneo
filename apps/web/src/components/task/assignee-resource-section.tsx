import { Check, Plus, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PickerNoResults } from "@/components/ui/picker-search-input";
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
import { matchesSearch } from "@/lib/search-match";
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
  /** Opens the invite dialog for a person resource that has an email. Given
   * (only to somebody who may invite), the section offers it right after such
   * a resource is created inline and as a button on each person row that can
   * still be invited; without it there is no invite UI at all. Nothing is sent
   * from here: the dialog asks for the roles and the projects. */
  onInviteResource?: (resource: Resource) => void;
  /** The picker's search text: only resources whose name (or kind) match it
   * are listed. Empty or missing lists all of them. */
  searchQuery?: string;
  /** Set by the picker when the search matched no person, so this section
   * can show the single "no results" state when it has no match either. */
  noUserMatches?: boolean;
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
  onInviteResource,
  searchQuery = "",
  noUserMatches = false,
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
      items: pickable.filter(
        (resource) =>
          resource.kind === resourceKind &&
          matchesSearch(
            `${resource.name} ${resource.email ?? ""} ${t(`tasks:popover.assignee.resourceKind.${resource.kind}`)}`,
            searchQuery,
          ),
      ),
    })).filter((group) => group.items.length > 0);
  }, [
    resources,
    projectUserIds,
    assignedResourceIds,
    selectedResourceIds,
    searchQuery,
    t,
  ]);

  const resetForm = () => {
    setName("");
    setKind("person");
    setEmail("");
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    // Only a person has an email.
    const trimmedEmail = kind === "person" ? email.trim() : "";

    try {
      const created = await createResource({
        workspaceId,
        kind,
        name: trimmedName,
        email: trimmedEmail || undefined,
      });
      onToggleResource(created.id);
      setFormOpen(false);
      resetForm();
      // The person was given an address: offer the invitation (the dialog is
      // where the user confirms it, nothing is sent here).
      if (trimmedEmail) onInviteResource?.(created);
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

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="space-y-1">
      {isSearching && noUserMatches && groupedResources.length === 0 && (
        <PickerNoResults>{t("tasks:picker.noResults")}</PickerNoResults>
      )}
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
                  const canInvite =
                    Boolean(onInviteResource) &&
                    resource.kind === "person" &&
                    Boolean(resource.email) &&
                    !resource.linked;
                  return (
                    <div key={resource.id} className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 min-w-0 flex-1 justify-start gap-2 px-2"
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
                        <span className="text-sm truncate">
                          {resource.name}
                        </span>
                        {isSelected && (
                          <Check className="ml-auto h-4 w-4 shrink-0" />
                        )}
                      </Button>
                      {canInvite &&
                        (resource.invitation?.status === "pending" ? (
                          <span className="shrink-0 px-1 text-[11px] text-muted-foreground">
                            {t("tasks:popover.assignee.invitationPending")}
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-muted-foreground"
                            aria-label={t(
                              "tasks:popover.assignee.inviteResource",
                            )}
                            title={t("tasks:popover.assignee.inviteResource")}
                            onClick={() => onInviteResource?.(resource)}
                          >
                            <Send className="size-3" aria-hidden="true" />
                          </Button>
                        ))}
                    </div>
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
                  <SelectValue>
                    {t(`tasks:popover.assignee.resourceKind.${kind}`)}
                  </SelectValue>
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
