import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";
import { BOARD_PAGE_LIMIT, loadBoardPages } from "./load-board-pages";

async function getTasks(projectId: string, signal?: AbortSignal) {
  return loadBoardPages(async (page, relatedPage) => {
    const response = await client.task.tasks[":projectId"].$get(
      {
        param: { projectId },
        query: {
          page: String(page),
          limit: String(BOARD_PAGE_LIMIT),
          ...(relatedPage ? { relatedPage: String(relatedPage) } : {}),
        },
      },
      { init: { signal } },
    );
    if (!response.ok)
      throw new HttpError(response.status, "Failed to fetch tasks");
    return response.json();
  }, signal);
}
export default getTasks;
