import { createFileRoute, Outlet } from "@tanstack/react-router";
import ProjectAccessGate from "@/components/project/project-access-gate";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId",
)({
  component: ProjectRoute,
});

// Shared by every page of a project: a project that answers 403 shows one
// translated "no access" state instead of each view's own error.
function ProjectRoute() {
  const { workspaceId, projectId } = Route.useParams();
  return (
    <ProjectAccessGate projectId={projectId} workspaceId={workspaceId}>
      <Outlet />
    </ProjectAccessGate>
  );
}
