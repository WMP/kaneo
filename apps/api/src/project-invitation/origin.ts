import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { schema } from "../database";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import type { SelectExecutor } from "../utils/role-statements";
import { INVITATION_ERROR_CODES, invitationError } from "./delegation";

// Does the caller hold `invitation:create` in their WORKSPACE role? This is the
// canonical workspace-permission decision (API key scope, instance
// administrators, the full-access shortcut, the workspace role of a project
// member), not a second implementation. The project routes decide by the
// project role, but an invitation that was not made through them belongs to
// the workspace: only somebody who could have made it may extend or re-send it.
// Asked before a transaction opens, because it does not depend on the
// invitation.
export function canInviteToWorkspace(c: Context): Promise<boolean> {
  return hasWorkspacePermission(c, { invitation: ["create"] });
}

// Refuses a caller who cannot invite to the workspace when the invitation is
// not a project-origin one (Better Auth's `invite-member`, or older than
// migration 0057: project invitations created before it, on a branch build
// only, have no origin row and count as workspace invitations). Used when attaching a project to an existing invitation and
// when re-sending one. Cancelling only removes a project and needs no such
// right.
export async function assertMayExtendInvitation(
  executor: SelectExecutor,
  invitationId: string,
  mayInviteToWorkspace: boolean,
): Promise<void> {
  if (mayInviteToWorkspace) return;
  const [origin] = await executor
    .select({ source: schema.invitationOriginTable.source })
    .from(schema.invitationOriginTable)
    .where(eq(schema.invitationOriginTable.invitationId, invitationId))
    .limit(1);
  if (origin?.source === "project") return;
  throw invitationError(
    409,
    INVITATION_ERROR_CODES.workspaceInvitationExists,
    "This is a workspace invitation; ask somebody who can invite to the workspace to extend or re-send it",
  );
}
