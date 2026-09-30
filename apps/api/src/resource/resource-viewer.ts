import type { Context } from "hono";
import {
  apiKeyAllows,
  hasWorkspacePermission,
} from "../utils/require-workspace-permission";
import { projectsCallerMayInviteTo } from "./invitable-projects";

const INVITE = { invitation: ["create"] };

// Who is looking at a resource response: the account (to decide which linked
// accounts it may see) and, decided only when a response has an invitation to
// show, whether it may see invitation state at all.
export type ResourceViewer = {
  userId: string;
  // `scope` is the caller's project scope when it is known already
  // (`accessibleProjectIds`); the first call decides for the whole response.
  canSeeInvitations: (scope?: string[] | null) => Promise<boolean>;
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
    canSeeInvitations: (scope) => {
      decided ??= (async () => {
        if (!apiKeyAllows(c, INVITE)) return false;
        if (await hasWorkspacePermission(c, INVITE)) return true;
        // Full access (`scope` null) has the workspace role's statements in
        // every project: the check above answered already.
        if (scope === null) return false;
        const projects = await projectsCallerMayInviteTo(userId, workspaceId, {
          stopAtFirst: true,
          scope,
        });
        return projects.length > 0;
      })();
      return decided;
    },
  };
}
