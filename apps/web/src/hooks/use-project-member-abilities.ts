import useGetProjectInvitations from "@/hooks/queries/project-invitation/use-get-project-invitations";
import useGetMemberCandidates from "@/hooks/queries/project-member/use-get-member-candidates";
import useGetProjectAssignableRoles from "@/hooks/queries/project-member/use-get-project-assignable-roles";
import { isForbiddenError } from "@/lib/http-error";

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
 * What the current user may do with the members of one project, derived from
 * what the API answers for them, in this one place:
 *
 * - project assignable roles: an empty list means no role can be handed out;
 * - member candidates: the route needs `member:create` in the caller's project
 *   role, so a 403 there means the member controls are not offered (the
 *   built-in roles grant `member:create|update|delete` together, so it also
 *   stands for changing roles and removing);
 * - the pending invitations list: it needs `invitation:create` or
 *   `invitation:cancel`, so a 403 there means no invitation controls.
 *
 * "No rights" comes from a 403 only. Any other failure leaves the answer
 * unknown and is reported through `hasError`.
 *
 * These are hints for what to show. The API decides every action, and a
 * refusal (for a custom role that grants only part of a bundle) is reported
 * to the user by the error mapping, never left as a silent failure.
 * Swapping the source for a dedicated capabilities answer changes this file
 * only.
 */
export function useProjectMemberAbilities(
  projectId: string | undefined,
): ProjectMemberAbilities {
  const roles = useGetProjectAssignableRoles(projectId);
  const candidates = useGetMemberCandidates(projectId);
  const invitations = useGetProjectInvitations(projectId);

  const assignableRoles = roles.data;
  const canAssignRoles = (assignableRoles?.length ?? 0) > 0;
  const memberRights = candidates.isSuccess;
  const invitationRights = invitations.isSuccess;

  const failedUnexpectedly = (query: {
    isError: boolean;
    error: unknown;
  }): boolean => query.isError && !isForbiddenError(query.error);
  const rolesFailed = roles.isError && assignableRoles === undefined;
  const hasError =
    rolesFailed ||
    failedUnexpectedly(candidates) ||
    failedUnexpectedly(invitations);

  return {
    isLoading: roles.isPending || candidates.isPending || invitations.isPending,
    hasError,
    retry: () => {
      if (rolesFailed) void roles.refetch();
      if (failedUnexpectedly(candidates)) void candidates.refetch();
      if (failedUnexpectedly(invitations)) void invitations.refetch();
    },
    assignableRoles,
    assignableRolesFailed: rolesFailed,
    refetchAssignableRoles: () => {
      void roles.refetch();
    },
    canAdd: memberRights && canAssignRoles,
    canInvite: invitationRights && canAssignRoles,
    canManage: memberRights,
    canCancelInvitations: invitationRights,
    canViewInvitations: invitationRights,
  };
}
