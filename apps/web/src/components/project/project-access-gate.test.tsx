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

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/fetchers/project/get-project-access", () => ({ default: vi.fn() }));

let accessState: { error: unknown };
const useQuery = vi.fn((_options: Record<string, unknown>) => accessState);
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
  it("shows a translated no-access state with a link back when the access answer is 403", () => {
    accessState = { error: new HttpError(403, "No access to the project") };
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

  it("renders the pages while the access loads or after it loaded", () => {
    accessState = { error: null };
    renderGate();

    expect(screen.getByText("the project pages")).toBeVisible();
    expect(screen.queryByText("projectMembers:noAccess.title")).toBeNull();
  });

  it("leaves other failures to the pages themselves", () => {
    accessState = { error: new HttpError(500, "boom") };
    renderGate();

    expect(screen.getByText("the project pages")).toBeVisible();
  });

  it("does not treat a 404 as missing access", () => {
    accessState = { error: new HttpError(404, "Project not found") };
    renderGate();

    expect(screen.getByText("the project pages")).toBeVisible();
  });

  it("asks the /access query afresh on every mount, sharing the capabilities' cache entry", () => {
    accessState = { error: null };
    renderGate();

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        // The key useProjectPermission reads: one cache entry, one request.
        queryKey: ["project-access", "project-1", "user-1"],
        refetchOnMount: "always",
        meta: { expectForbidden: true },
        enabled: true,
      }),
    );
  });
});
