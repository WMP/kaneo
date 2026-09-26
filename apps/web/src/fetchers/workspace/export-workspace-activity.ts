import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type ExportWorkspaceActivityParams = {
  workspaceId: string;
  userId?: string;
  type?: string;
  from?: string;
  to?: string;
  format: "csv" | "json";
};

export type ExportWorkspaceActivityResult = {
  blob: Blob;
  filename: string;
  truncated: boolean;
};

const DEFAULT_FILENAMES = {
  csv: "workspace-activity-export.csv",
  json: "workspace-activity-export.json",
};

function filenameFromContentDisposition(
  value: string | null,
  format: "csv" | "json",
): string {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? DEFAULT_FILENAMES[format];
}

async function exportWorkspaceActivity({
  workspaceId,
  userId,
  type,
  from,
  to,
  format,
}: ExportWorkspaceActivityParams): Promise<ExportWorkspaceActivityResult> {
  const response = await client.workspace[":workspaceId"].activity.export.$get({
    param: { workspaceId },
    query: {
      ...(userId ? { userId } : {}),
      ...(type ? { type } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      format,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const blob = await response.blob();
  const filename = filenameFromContentDisposition(
    response.headers.get("Content-Disposition"),
    format,
  );
  const truncated = response.headers.get("X-Kaneo-Export-Truncated") === "true";

  return { blob, filename, truncated };
}

export default exportWorkspaceActivity;
