import type { Context } from "hono";
import { resolveAssetBearerOrCookie } from "./authenticate-api-request";
import { requireProjectAccessFor } from "./project-access";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type AssetAccessTarget = {
  workspaceId: string;
  projectId: string;
  isPublic: boolean | null;
  surface: string;
};

/** Only description assets belong to the public project representation. */
export function isPublicAsset(asset: AssetAccessTarget): boolean {
  return asset.isPublic === true && asset.surface === "description";
}

export async function authorizeAssetAccess(
  c: Context,
  asset: AssetAccessTarget,
): Promise<void> {
  if (isPublicAsset(asset)) {
    return;
  }

  const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);
  await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);
  // Workspace membership is not enough: assets belong to a project.
  await requireProjectAccessFor(userId, asset.projectId);
}
