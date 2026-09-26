import type { ProjectWithTasks } from "@/types/project";

// Shared by every board-page fetcher (board/backlog/calendar/Gantt all read
// through getTasks/getPublicProject below). Matches the API's own
// MAX_TASK_LIST_LIMIT (see apps/api/src/task/schema.ts) — requesting more
// than the server allows would just get silently clamped, so the two stay in
// sync by hand. Raised from 100 so a large project (e.g. 1000+ Gantt tasks)
// loads in a handful of sequential page round-trips instead of dozens.
export const BOARD_PAGE_LIMIT = 500;

export type BoardPage<T extends ProjectWithTasks> = {
  data: T;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    total: number;
    relatedTotalPages?: number;
  };
};

/** Keep the existing board cache shape, but fetch one bounded page at a time. */
export async function loadBoardPages<T extends ProjectWithTasks>(
  load: (page: number, relatedPage?: number) => Promise<BoardPage<T>>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const first = await load(1);
  const result = first.data;
  const columns = new Map(result.columns.map((column) => [column.id, column]));
  const seen = new Map(
    [
      ...result.columns.flatMap((column) => column.tasks),
      ...result.archivedTasks,
      ...result.plannedTasks,
    ].map((task) => [task.id, task]),
  );
  const mergeById = <U extends { id: string }>(
    left: U[] = [],
    right: U[] = [],
  ) =>
    Array.from(
      new Map([...left, ...right].map((value) => [value.id, value])).values(),
    );
  const append = (
    target: ProjectWithTasks["plannedTasks"],
    tasks: ProjectWithTasks["plannedTasks"],
  ) => {
    for (const task of tasks) {
      if (!seen.has(task.id)) {
        seen.set(task.id, task);
        target.push(task);
      } else {
        const existing = seen.get(task.id);
        if (existing) {
          existing.labels = mergeById(existing.labels, task.labels);
          existing.externalLinks = mergeById(
            existing.externalLinks,
            task.externalLinks,
          );
        }
      }
    }
  };
  const merge = (next: BoardPage<T>) => {
    for (const column of next.data.columns) {
      let target = columns.get(column.id);
      if (!target) {
        target = { ...column, tasks: [] };
        columns.set(column.id, target);
        result.columns.push(target);
      }
      append(target.tasks, column.tasks);
    }
    append(result.archivedTasks, next.data.archivedTasks);
    append(result.plannedTasks, next.data.plannedTasks);
  };
  const loadRelated = async (page: number, initial: BoardPage<T>) => {
    // Each collection uses its initial count; live additions cannot indefinitely
    // extend a refresh. The next refresh sees changes made during pagination.
    const total = initial.pagination.relatedTotalPages ?? 1;
    for (let relatedPage = 2; relatedPage <= total; relatedPage++) {
      signal?.throwIfAborted();
      merge(await load(page, relatedPage));
    }
  };
  await loadRelated(1, first);
  for (let page = 2; page <= first.pagination.totalPages; page++) {
    signal?.throwIfAborted();
    const next = await load(page);
    merge(next);
    await loadRelated(page, next);
  }
  result.columns.sort(
    (left, right) => (left.position ?? 0) - (right.position ?? 0),
  );
  signal?.throwIfAborted();
  return result;
}
