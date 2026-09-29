import type { Context } from "hono";
import {
  accessibleProjectIds,
  projectAccessSatisfies,
  resolveProjectAccessMap,
} from "../utils/project-access";
import {
  apiKeyAllows,
  hasWorkspacePermission,
} from "../utils/require-workspace-permission";

const INVITE = { invitation: ["create"] };

// Who is looking at a resource response: the account (to decide which linked
// accounts it may see) and, decided only when a response has an invitation to
// show, whether it may see invitation state at all.
export type ResourceViewer = {
  userId: string;
  canSeeInvitations: () => Promise<boolean>;
};

// May the caller see the state of invitations? Whoever could send one:
// `invitation:create` in the workspace role, or in at least one project they
// can open (the project invitation routes decide by project statements). The
// API key scope applies as everywhere.
export function resourceViewer(c: Context): ResourceViewer {
  const userId = c.get("userId") as string;
  const workspaceId = c.get("workspaceId") as string;
  let decided: Promise<boolean> | null = null;
  return {
    userId,
    canSeeInvitations: () => {
      decided ??= (async () => {
        if (!apiKeyAllows(c, INVITE)) return false;
        if (await hasWorkspacePermission(c, INVITE)) return true;
        const ids = await accessibleProjectIds(userId, workspaceId);
        // `null` is full access: the workspace role answered above already.
        if (!ids || ids.length === 0) return false;
        const accesses = await resolveProjectAccessMap(userId, ids);
        return [...accesses.values()].some((access) =>
          projectAccessSatisfies(access, INVITE),
        );
      })();
      return decided;
    },
  };
}
