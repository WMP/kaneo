import getProjectAccess from "@/fetchers/project/get-project-access";
import { HttpError } from "@/lib/http-error";

// Prefix that matches every cached access of a project (all users). Anything
// that changes who may do what in a project must invalidate it: a closed
// project socket, workspace role and membership changes, and mutations of the
// project's own members.
export const projectAccessQueryKey = (projectId: string) =>
  ["project-access", projectId] as const;

export const projectAccessKey = (
  projectId: string,
  userId: string | undefined,
) => [...projectAccessQueryKey(projectId), userId] as const;

export const projectAccessQueryOptions = (
  projectId: string,
  userId: string | undefined,
) => ({
  queryKey: projectAccessKey(projectId, userId),
  queryFn: () => getProjectAccess(projectId),
});

// The API refuses a project the caller can no longer open with 403.
export function isProjectAccessDenied(error: unknown): boolean {
  return error instanceof HttpError && error.status === 403;
}
