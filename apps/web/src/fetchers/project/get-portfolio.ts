import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type GetPortfolioRequest = InferRequestType<
  (typeof client)["project"]["portfolio"]["$get"]
>["query"];

async function getPortfolio({ workspaceId }: GetPortfolioRequest) {
  if (!workspaceId) return;

  const response = await client.project.portfolio.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default getPortfolio;
