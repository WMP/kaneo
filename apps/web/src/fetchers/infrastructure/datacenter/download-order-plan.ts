import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type DownloadOrderPlanResult = {
  blob: Blob;
  filename: string;
};

const DEFAULT_FILENAME = "order-plan.xlsx";

function filenameFromContentDisposition(value: string | null): string {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? DEFAULT_FILENAME;
}

async function downloadOrderPlan(
  workspaceId: string,
): Promise<DownloadOrderPlanResult> {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "order-plan.xlsx"
  ].$get({ param: { workspaceId } });

  if (!response.ok) throw await readInfrastructureError(response);

  const blob = await response.blob();
  const filename = filenameFromContentDisposition(
    response.headers.get("Content-Disposition"),
  );

  return { blob, filename };
}

export default downloadOrderPlan;
