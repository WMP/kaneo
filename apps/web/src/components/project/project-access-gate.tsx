import type { ReactNode } from "react";
import useGetProject from "@/hooks/queries/project/use-get-project";
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
 */
function ProjectAccessGate({ projectId, workspaceId, children }: Props) {
  const { error } = useGetProject({ id: projectId, workspaceId });
  if (isForbiddenError(error)) {
    return <ProjectNoAccess workspaceId={workspaceId} />;
  }
  return children;
}

export default ProjectAccessGate;
