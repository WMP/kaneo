import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import getProjectAccess, {
  type ProjectCapabilities,
} from "@/fetchers/project/get-project-access";
import { HttpError } from "@/lib/http-error";

// Prefix that matches every cached access of a project (all users). Project
// member and invitation mutations invalidate it.
export const projectAccessQueryKey = (projectId: string) =>
  ["project-access", projectId] as const;

const accessKey = (projectId: string, userId: string | undefined) =>
  [...projectAccessQueryKey(projectId), userId] as const;

const NO_CAPABILITIES: ProjectCapabilities = {
  createTasks: false,
  updateTasks: false,
  deleteTasks: false,
  assignTasks: false,
  createLabels: false,
  updateLabels: false,
  deleteLabels: false,
  updateProject: false,
  deleteProject: false,
  shareProject: false,
  manageMembers: false,
  addMembers: false,
  inviteToProject: false,
  cancelProjectInvitations: false,
  manageIntegrations: false,
};

// What the signed-in user may do INSIDE one project: the project role for a
// project member, the workspace role for a full-access user. The API decides
// (`GET /api/project/{projectId}/access`); this is only a UI affordance, every
// action is enforced again by the API. Use `useWorkspacePermission` for
// workspace-level actions (creating projects, settings, members, roles).
export function useProjectPermission(projectId: string | undefined) {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: accessKey(projectId ?? "", userId),
    queryFn: () => getProjectAccess(projectId ?? ""),
    enabled: Boolean(projectId && userId),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    // Losing access answers 403: do not retry it.
    retry: (failureCount, failure) =>
      !(failure instanceof HttpError && failure.status === 403) &&
      failureCount < 2,
  });

  const can = data?.capabilities ?? NO_CAPABILITIES;

  return useMemo(
    () => ({
      canCreateTasks: () => can.createTasks,
      canUpdateTasks: () => can.updateTasks,
      canDeleteTasks: () => can.deleteTasks,
      canAssignTasks: () => can.assignTasks,
      canCreateLabels: () => can.createLabels,
      canUpdateLabels: () => can.updateLabels,
      canDeleteLabels: () => can.deleteLabels,
      canUpdateProject: () => can.updateProject,
      canDeleteProject: () => can.deleteProject,
      canShareProject: () => can.shareProject,
      canManageMembers: () => can.manageMembers,
      canAddMembers: () => can.addMembers,
      canInviteToProject: () => can.inviteToProject,
      canCancelProjectInvitations: () => can.cancelProjectInvitations,
      canManageIntegrations: () => can.manageIntegrations,
      mode: data?.mode ?? null,
      role: data?.role ?? null,
      // True until the first answer arrives, so action UI is not flashed on
      // and off.
      isCheckingPermissions: Boolean(projectId && userId) && isLoading,
      isError,
      error,
    }),
    [can, data?.mode, data?.role, isLoading, isError, error, projectId, userId],
  );
}
