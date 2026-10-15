import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import { unlinkUserResources } from "../resource/link-resource";
import { runIndependently } from "../utils/run-independently";
import {
  closeUserWorkspaceConnections,
  revokeWorkspaceConnections,
} from "../ws";

// What must happen once a person is no longer a member of a workspace. Their
// project memberships are removed by the caller (`beforeRemoveMember`, or the
// admin removal inside its transaction). The resources linked to the account
// stop being linked (nothing moves back), their project sockets close at once
// and the clients are told the workspace access is gone. Each step runs
// whatever the others did; every failure is logged and the first is thrown.
export function memberGoneSteps(
  workspaceId: string,
  userId: string,
  userRole: string | null | undefined,
): Array<[label: string, run: () => Promise<unknown>]> {
  return [
    ["Unlinking the resources", () => unlinkUserResources(userId, workspaceId)],
    [
      "Closing the sockets",
      () => closeUserWorkspaceConnections(userId, workspaceId),
    ],
    [
      "Revoking the workspace connections",
      () =>
        revokeWorkspaceConnections(userId, workspaceId, {
          role: userRole ?? null,
        }),
    ],
  ];
}

export async function handleMemberRemoved(removal: {
  workspaceId: string;
  userId: string;
  userRole: string | null | undefined;
}) {
  const { workspaceId, userId, userRole } = removal;
  // The removal is done; a failing cleanup step is logged only.
  await runIndependently(memberGoneSteps(workspaceId, userId, userRole)).catch(
    () => undefined,
  );
  void syncWorkspaceSeats(workspaceId).catch((error) => {
    console.error("Seat sync after member remove failed:", error);
  });
}
