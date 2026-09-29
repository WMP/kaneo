import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import getProject from "@/fetchers/project/get-project";
import { isForbiddenError } from "@/lib/http-error";
import ProjectNoAccess from "./project-no-access";

type Props = {
  projectId: string;
  workspaceId: string;
  children: ReactNode;
};

/**
 * Wraps the pages of one project. When the project itself answers 403 (the
 * person was removed, or never added) the pages give way to a translated
 * "no access" state with a link back, instead of each view failing with its
 * own generic error. Every other outcome renders the pages as before.
 *
 * The app keeps queries cached and does not refetch on mount, so a project that
 * was fetched before the person lost access would look fine. The gate reads the
 * project (same key as `useGetProject`, so it shares the cache entry) afresh
 * every time the project pages mount.
 */
function ProjectAccessGate({ projectId, workspaceId, children }: Props) {
  const { error } = useQuery({
    queryKey: ["projects", workspaceId, projectId],
    queryFn: () => getProject({ id: projectId, workspaceId }),
    enabled: !!projectId,
    refetchOnMount: "always",
    // A 403 is the answer here, not a failure to report.
    meta: { expectForbidden: true },
  });
  if (isForbiddenError(error)) {
    return <ProjectNoAccess workspaceId={workspaceId} />;
  }
  return children;
}

export default ProjectAccessGate;
