import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Resource from "@/types/resource";
import AssigneeResourceSection from "./assignee-resource-section";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/resource/use-create-resource", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const make = (id: string, name: string, userId: string | null): Resource => ({
  id,
  workspaceId: "ws-1",
  kind: "person",
  name,
  email: null,
  userId,
  createdAt: "2026-09-19T12:00:00Z",
  updatedAt: "2026-09-19T12:00:00Z",
});

afterEach(cleanup);

describe("AssigneeResourceSection", () => {
  const resources = [
    make("r1", "Free Fred", null),
    make("r2", "Linked Lena", "u2"),
  ];

  it("leaves out a resource that is linked to an account: the member is picked instead", () => {
    render(
      <AssigneeResourceSection
        workspaceId="ws-1"
        resources={resources}
        selectedResourceIds={[]}
        onToggleResource={vi.fn()}
        canCreateResource={false}
      />,
    );

    expect(screen.getByText("Free Fred")).toBeInTheDocument();
    expect(screen.queryByText("Linked Lena")).toBeNull();
  });

  it("keeps a linked resource that is still on the task, so it can be removed", () => {
    render(
      <AssigneeResourceSection
        workspaceId="ws-1"
        resources={resources}
        selectedResourceIds={["r2"]}
        onToggleResource={vi.fn()}
        canCreateResource={false}
      />,
    );

    expect(screen.getByText("Linked Lena")).toBeInTheDocument();
  });
});
