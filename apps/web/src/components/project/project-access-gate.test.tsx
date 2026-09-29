import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import ProjectAccessGate from "./project-access-gate";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params: Record<string, string>;
  }) => <a href={to.replace("$workspaceId", params.workspaceId)}>{children}</a>,
}));

vi.mock("@/fetchers/project/get-project", () => ({ default: vi.fn() }));

let projectState: { error: unknown };
const useQuery = vi.fn((_options: Record<string, unknown>) => projectState);
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => useQuery(options),
}));

afterEach(() => {
  cleanup();
  useQuery.mockClear();
});

function renderGate() {
  return render(
    <ProjectAccessGate projectId="project-1" workspaceId="workspace-1">
      <div>the project pages</div>
    </ProjectAccessGate>,
  );
}

describe("ProjectAccessGate", () => {
  it("shows a translated no-access state with a link back when the project answers 403", () => {
    projectState = { error: new HttpError(403, "No access to the project") };
    renderGate();

    expect(screen.getByText("projectMembers:noAccess.title")).toBeVisible();
    expect(
      screen.getByText("projectMembers:noAccess.description"),
    ).toBeVisible();
    expect(screen.queryByText("the project pages")).toBeNull();
    expect(
      screen.getByRole("link", { name: "projectMembers:noAccess.back" }),
    ).toHaveAttribute("href", "/dashboard/workspace/workspace-1");
  });

  it("renders the pages while the project loads or after it loaded", () => {
    projectState = { error: null };
    renderGate();

    expect(screen.getByText("the project pages")).toBeVisible();
    expect(screen.queryByText("projectMembers:noAccess.title")).toBeNull();
  });

  it("leaves other failures to the pages themselves", () => {
    projectState = { error: new HttpError(500, "boom") };
    renderGate();

    expect(screen.getByText("the project pages")).toBeVisible();
  });

  it("does not treat a 404 as missing access", () => {
    projectState = { error: new HttpError(404, "Project not found") };
    renderGate();

    expect(screen.getByText("the project pages")).toBeVisible();
  });

  it("reads the project afresh on every mount, so a cached project cannot hide a revoked access", () => {
    projectState = { error: null };
    renderGate();

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        // Same key as useGetProject: one cache entry, one request.
        queryKey: ["projects", "workspace-1", "project-1"],
        refetchOnMount: "always",
        meta: { expectForbidden: true },
      }),
    );
  });
});
