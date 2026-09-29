import { useQueryClient } from "@tanstack/react-query";
import useGetProjectAssignableRoles from "@/hooks/queries/project-member/use-get-project-assignable-roles";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { isForbiddenError } from "@/lib/http-error";
import { projectAccessQueryKey } from "@/lib/project-access-query";

export type ProjectMemberAbilities = {
  /** True until the answers below are known; show no controls meanwhile. */
  isLoading: boolean;
  /**
   * An answer failed for a reason other than "not allowed" (network, 5xx). The
   * controls that depend on it are unknown, not refused: show an error with
   * `retry` instead of silently hiding them.
   */
  hasError: boolean;
  retry: () => void;
  /** Roles the caller may hand out here; undefined until loaded (or failed). */
  assignableRoles: { role: string; isDefault: boolean }[] | undefined;
  assignableRolesFailed: boolean;
  refetchAssignableRoles: () => void;
  /** Add an existing workspace member to the project. */
  canAdd: boolean;
  /** Invite somebody who is not in the workspace by email. */
  canInvite: boolean;
  /** Change project roles of other members and remove them. */
  canManage: boolean;
  /** Cancel a pending project invitation. */
  canCancelInvitations: boolean;
  /** See the pending project invitations at all. */
  canViewInvitations: boolean;
};

/**
 * What the current user may do with the members of one project. The answer is
 * the project capabilities of `GET /api/project/{id}/access`
 * (`useProjectPermission`), which the API evaluates with the logic of the
 * routes themselves; only the assignable roles (an empty list means no role can
 * be handed out) are asked separately, and only when a capability needs them.
 *
 * "No rights" comes from the capability being false, and a refused (403)
 * project answers all false. Any other failure leaves the answer unknown and is
 * reported through `hasError`, never turned into hidden controls.
 *
 * These are hints for what to show. The API decides every action, and a
 * refusal is reported to the user by the error mapping, never left as a silent
 * failure.
 */
export function useProjectMemberAbilities(
  projectId: string | undefined,
): ProjectMemberAbilities {
  const queryClient = useQueryClient();
  const permission = useProjectPermission(projectId);

  const mayAdd = permission.canAddMembers();
  const mayInvite = permission.canInviteToProject();
  const canManage = permission.canManageMembers();
  const canCancelInvitations = permission.canCancelProjectInvitations();

  // Roles are needed to add, invite or change a role, and only then.
  const needsRoles = mayAdd || mayInvite || canManage;
  const roles = useGetProjectAssignableRoles(projectId, {
    enabled: needsRoles,
  });
  const assignableRoles = roles.data;
  const canAssignRoles = (assignableRoles?.length ?? 0) > 0;

  const permissionFailed =
    permission.isError && !isForbiddenError(permission.error);
  const rolesFailed =
    needsRoles && roles.isError && assignableRoles === undefined;

  return {
    isLoading:
      permission.isCheckingPermissions || (needsRoles && roles.isPending),
    hasError: permissionFailed || rolesFailed,
    retry: () => {
      if (permissionFailed && projectId) {
        void queryClient.invalidateQueries({
          queryKey: projectAccessQueryKey(projectId),
        });
      }
      if (rolesFailed) void roles.refetch();
    },
    assignableRoles,
    assignableRolesFailed: rolesFailed,
    refetchAssignableRoles: () => {
      void roles.refetch();
    },
    canAdd: mayAdd && canAssignRoles,
    canInvite: mayInvite && canAssignRoles,
    canManage,
    canCancelInvitations,
    // Listing needs invitation:create or invitation:cancel.
    canViewInvitations: mayInvite || canCancelInvitations,
  };
}
