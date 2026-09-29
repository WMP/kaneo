import { createFileRoute } from "@tanstack/react-router";
import {
  Box,
  Link2,
  Pencil,
  Plus,
  Send,
  Trash2,
  Unlink,
  User,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import ResourceInviteDialog from "@/components/resource/resource-invite-dialog";
import ResourceLinkDialog from "@/components/resource/resource-link-dialog";
import ResourceStatusBadge from "@/components/resource/resource-status-badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useCreateResource from "@/hooks/mutations/resource/use-create-resource";
import useDeleteResource from "@/hooks/mutations/resource/use-delete-resource";
import useUnlinkResource from "@/hooks/mutations/resource/use-unlink-resource";
import useUpdateResource from "@/hooks/mutations/resource/use-update-resource";
import useGetWorkspaceResources from "@/hooks/queries/resource/use-get-workspace-resources";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getResourceErrorMessage } from "@/lib/resource-error";
import { toast } from "@/lib/toast";
import type Resource from "@/types/resource";
import type { ResourceKind } from "@/types/resource";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/resources",
)({
  component: RouteComponent,
});

const RESOURCE_KINDS: ResourceKind[] = ["person", "equipment", "material"];

const KIND_ICONS: Record<ResourceKind, typeof Wrench> = {
  person: User,
  equipment: Wrench,
  material: Box,
};

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, canUpdateProjects, canManageTeam } =
    useWorkspacePermission();
  // Gated the same as POST/PATCH/DELETE /resource (project:update) — see
  // resource/index.ts.
  const canManage = canUpdateProjects();
  // Linking a resource to a member also needs member:update (see the link
  // route); inviting is decided per project by the API, which the dialog shows.
  const canLink = canManage && canManageTeam();
  const workspaceId = workspace?.id ?? "";

  const {
    data: resources = [],
    isLoading,
    isError,
  } = useGetWorkspaceResources(workspaceId);

  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();
  const unlinkResource = useUnlinkResource();

  const kindLabel = (kind: ResourceKind) =>
    t(`settings:workspaceResources.kind.${kind}`);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<ResourceKind>("person");
  const [newEmail, setNewEmail] = useState("");
  const [createError, setCreateError] = useState("");

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editError, setEditError] = useState("");

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingResource, setDeletingResource] = useState<Resource | null>(
    null,
  );

  // Invite, link and unlink dialogs
  const [inviting, setInviting] = useState<Resource | null>(null);
  const [linking, setLinking] = useState<Resource | null>(null);
  const [unlinking, setUnlinking] = useState<Resource | null>(null);

  const handleUnlink = async () => {
    if (!unlinking) return;

    try {
      await unlinkResource.mutateAsync({ id: unlinking.id });
      toast.success(t("settings:workspaceResources.unlink.success"));
      setUnlinking(null);
    } catch (error) {
      toast.error(
        getResourceErrorMessage(
          error,
          t,
          "settings:workspaceResources.unlink.error",
        ),
      );
    }
  };

  const resetCreate = () => {
    setNewName("");
    setNewKind("person");
    setNewEmail("");
    setCreateError("");
  };

  const openCreate = () => {
    resetCreate();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError(t("settings:workspaceResources.nameRequired"));
      return;
    }

    try {
      await createResource.mutateAsync({
        workspaceId,
        kind: newKind,
        name: trimmed,
        email: newKind === "person" ? newEmail.trim() || undefined : undefined,
      });
      toast.success(t("settings:workspaceResources.createSuccess"));
      setCreateOpen(false);
      resetCreate();
    } catch (error) {
      toast.error(
        getResourceErrorMessage(
          error,
          t,
          "settings:workspaceResources.createError",
        ),
      );
    }
  };

  const openEdit = (resource: Resource) => {
    setEditingResource(resource);
    setEditName(resource.name);
    setEditEmail(resource.email ?? "");
    setEditError("");
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingResource) return;

    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError(t("settings:workspaceResources.nameRequired"));
      return;
    }

    try {
      await updateResource.mutateAsync({
        id: editingResource.id,
        name: trimmed,
        // Only a person has an email; leave it out for the other kinds.
        ...(editingResource.kind === "person"
          ? { email: editEmail.trim() || null }
          : {}),
      });
      toast.success(t("settings:workspaceResources.updateSuccess"));
      setEditOpen(false);
      setEditingResource(null);
    } catch (error) {
      toast.error(
        getResourceErrorMessage(
          error,
          t,
          "settings:workspaceResources.updateError",
        ),
      );
    }
  };

  const openDelete = (resource: Resource) => {
    setDeletingResource(resource);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingResource) return;

    try {
      await deleteResource.mutateAsync({ id: deletingResource.id });
      toast.success(t("settings:workspaceResources.deleteSuccess"));
      setDeleteOpen(false);
      setDeletingResource(null);
    } catch (error) {
      toast.error(
        getResourceErrorMessage(
          error,
          t,
          "settings:workspaceResources.deleteError",
        ),
      );
    }
  };

  return (
    <>
      <PageTitle title={t("settings:workspaceResources.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceResources.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceResources.subtitle")}
          </p>
        </div>

        <CardFrame>
          <Card className="!rounded-none !border-t-0">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <Wrench className="size-4" />
                {t("settings:workspaceResources.title")}
              </CardTitle>
              <CardDescription>
                {t("settings:workspaceResources.cardDescription")}
              </CardDescription>
              {canManage && (
                <CardAction>
                  <Button onClick={openCreate} className="gap-2">
                    <Plus className="size-4" />
                    {t("settings:workspaceResources.createResource")}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
          </Card>

          <Card className="!rounded-none">
            <CardPanel className="p-4">
              {isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("settings:workspaceResources.loading")}
                </p>
              ) : isError ? (
                // Distinguish a failed fetch from a genuinely empty workspace,
                // so a load error never masquerades as "no resources yet".
                <p className="py-6 text-center text-sm text-destructive">
                  {t("settings:workspaceResources.loadError")}
                </p>
              ) : resources.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <Wrench className="size-8 text-muted-foreground" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t("settings:workspaceResources.empty")}
                    </EmptyTitle>
                    <EmptyDescription />
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="divide-y divide-border">
                  {resources.map((resource) => {
                    // Fallback guard: an unexpected kind (future/garbled data)
                    // degrades one row's icon rather than crashing the list.
                    const KindIcon = KIND_ICONS[resource.kind] ?? Box;
                    return (
                      <div
                        key={resource.id}
                        className="flex items-center justify-between py-2.5 px-1"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/30 bg-muted">
                            <KindIcon className="size-3.5 text-muted-foreground" />
                          </div>
                          <span className="text-sm truncate">
                            {resource.name}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {kindLabel(resource.kind)}
                          </span>
                          {resource.email && (
                            <span className="text-xs text-muted-foreground truncate">
                              {resource.email}
                            </span>
                          )}
                          <ResourceStatusBadge resource={resource} />
                        </div>
                        {canManage && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {resource.kind === "person" && !resource.userId && (
                              <>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="gap-1"
                                  disabled={!resource.email}
                                  title={
                                    resource.email
                                      ? undefined
                                      : t(
                                          "settings:workspaceResources.inviteNeedsEmail",
                                        )
                                  }
                                  onClick={() => setInviting(resource)}
                                >
                                  <Send className="size-3" />
                                  {t(
                                    "settings:workspaceResources.inviteAction",
                                  )}
                                </Button>
                                {canLink && (
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    className="gap-1"
                                    onClick={() => setLinking(resource)}
                                  >
                                    <Link2 className="size-3" />
                                    {t(
                                      "settings:workspaceResources.linkAction",
                                    )}
                                  </Button>
                                )}
                              </>
                            )}
                            {resource.kind === "person" &&
                              resource.userId &&
                              canLink && (
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="gap-1"
                                  onClick={() => setUnlinking(resource)}
                                >
                                  <Unlink className="size-3" />
                                  {t(
                                    "settings:workspaceResources.unlinkAction",
                                  )}
                                </Button>
                              )}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t(
                                "settings:workspaceResources.editResource",
                              )}
                              className="h-8 w-8"
                              onClick={() => openEdit(resource)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t(
                                "settings:workspaceResources.deleteResource",
                              )}
                              disabled={deleteResource.isPending}
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => openDelete(resource)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardPanel>
          </Card>
        </CardFrame>
      </div>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => !open && setCreateOpen(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceResources.createResource")}
            </DialogTitle>
            <DialogDescription>
              {t("settings:workspaceResources.createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 pt-1 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-resource-name">
                {t("settings:workspaceResources.nameLabel")}
              </Label>
              <Input
                id="new-resource-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCreateError("");
                }}
                placeholder={t("settings:workspaceResources.namePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !createResource.isPending)
                    handleCreate();
                }}
              />
              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("settings:workspaceResources.kindLabel")}</Label>
              <Select
                value={newKind}
                onValueChange={(value) => setNewKind(value as ResourceKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kindLabel(kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newKind === "person" && (
              <div className="space-y-2">
                <Label htmlFor="new-resource-email">
                  {t("settings:workspaceResources.emailLabel")}
                </Label>
                <Input
                  id="new-resource-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t(
                    "settings:workspaceResources.emailPlaceholder",
                  )}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={createResource.isPending}>
              {t("settings:workspaceResources.createResource")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditOpen(false);
            setEditingResource(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceResources.editResource")}
            </DialogTitle>
            <DialogDescription>
              {t("settings:workspaceResources.editDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 pt-1 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-resource-name">
                {t("settings:workspaceResources.nameLabel")}
              </Label>
              <Input
                id="edit-resource-name"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  setEditError("");
                }}
                placeholder={t("settings:workspaceResources.namePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !updateResource.isPending)
                    handleEdit();
                }}
              />
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
            </div>

            {editingResource?.kind === "person" && (
              <div className="space-y-2">
                <Label htmlFor="edit-resource-email">
                  {t("settings:workspaceResources.emailLabel")}
                </Label>
                <Input
                  id="edit-resource-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder={t(
                    "settings:workspaceResources.emailPlaceholder",
                  )}
                />
                {editingResource.invitation && (
                  <p className="text-xs text-muted-foreground">
                    {t("settings:workspaceResources.emailChangeDetaches")}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditingResource(null);
              }}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button onClick={handleEdit} disabled={updateResource.isPending}>
              {t("settings:workspaceResources.saveResource")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {inviting && workspaceId && (
        <ResourceInviteDialog
          resource={inviting}
          workspaceId={workspaceId}
          onClose={() => setInviting(null)}
          onLinkInstead={(resource) => {
            setInviting(null);
            setLinking(resource);
          }}
        />
      )}

      {linking && workspaceId && (
        <ResourceLinkDialog
          resource={linking}
          workspaceId={workspaceId}
          onClose={() => setLinking(null)}
        />
      )}

      {/* Unlink Confirmation */}
      <AlertDialog
        open={unlinking !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceResources.unlink.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:workspaceResources.unlink.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setUnlinking(null)}>
              {t("common:actions.cancel")}
            </Button>
            <Button onClick={handleUnlink} disabled={unlinkResource.isPending}>
              {t("settings:workspaceResources.unlinkAction")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOpen(false);
            setDeletingResource(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceResources.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:workspaceResources.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setDeletingResource(null);
              }}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteResource.isPending}
            >
              {deleteResource.isPending
                ? t("common:actions.deleting")
                : t("settings:workspaceResources.deleteResource")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
