import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  isProjectAccessDenied,
  projectAccessQueryOptions,
} from "@/lib/project-access-query";
import ProjectNoAccess from "./project-no-access";

type Props = {
  projectId: string;
  workspaceId: string;
  children: ReactNode;
};

/**
 * Wraps the pages of one project. When the project's access answer is 403 (the
 * person was removed, or never added) the pages give way to a translated
 * "no access" state with a link back, instead of each view failing with its
 * own generic error. Every other outcome renders the pages as before.
 *
 * The answer is `GET /api/project/{id}/access`, the query the project
 * capabilities read (`useProjectPermission`, same key, one cache entry). The
 * app keeps queries cached and does not refetch on mount, so an answer from
 * before the person lost access would look fine: the gate asks afresh every
 * time the project pages mount.
 */
function ProjectAccessGate({ projectId, workspaceId, children }: Props) {
  const { user } = useAuth();
  const { error } = useQuery({
    ...projectAccessQueryOptions(projectId, user?.id),
    enabled: Boolean(projectId && user?.id),
    refetchOnMount: "always",
    // A 403 is the answer here, not a failure to report.
    meta: { expectForbidden: true },
  });
  if (isProjectAccessDenied(error)) {
    return <ProjectNoAccess workspaceId={workspaceId} />;
  }
  return children;
}

export default ProjectAccessGate;
