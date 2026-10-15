import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";

export async function handleMemberAdded(workspaceId: string) {
  void syncWorkspaceSeats(workspaceId).catch((error) => {
    console.error("Seat sync after member add failed:", error);
  });
}
