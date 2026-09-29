import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Resource from "@/types/resource";
import ResourceStatusBadge, {
  getResourceStatus,
} from "./resource-status-badge";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}|${options.name}` : key,
  }),
}));

const person: Resource = {
  id: "r1",
  workspaceId: "ws-1",
  kind: "person",
  name: "Alice",
  email: "alice@example.com",
  userId: null,
  linked: false,
  createdAt: "2026-09-19T12:00:00Z",
  updatedAt: "2026-09-19T12:00:00Z",
};

afterEach(cleanup);

describe("getResourceStatus", () => {
  it("has no status for equipment or material", () => {
    expect(getResourceStatus({ ...person, kind: "equipment" })).toBeNull();
    expect(getResourceStatus({ ...person, kind: "material" })).toBeNull();
  });

  it("prefers the link over an invitation that is still remembered", () => {
    expect(
      getResourceStatus({
        ...person,
        userId: "u1",
        linked: true,
        user: { id: "u1", name: "Ann", email: "a@example.com", image: null },
        invitation: { status: "pending", expiresAt: "2026-10-01T00:00:00Z" },
      }),
    ).toEqual({ kind: "linked", name: "Ann" });
  });

  it("does not know the name when the caller cannot see the member", () => {
    expect(
      getResourceStatus({ ...person, userId: "u1", linked: true, user: null }),
    ).toEqual({
      kind: "linked",
      name: null,
    });
  });

  it("reports pending, expired and none", () => {
    expect(
      getResourceStatus({
        ...person,
        invitation: { status: "pending", expiresAt: "2026-10-01T00:00:00Z" },
      }),
    ).toEqual({ kind: "invited", state: "pending" });
    expect(
      getResourceStatus({
        ...person,
        invitation: { status: "expired", expiresAt: "2026-09-01T00:00:00Z" },
      }),
    ).toEqual({ kind: "invited", state: "expired" });
    expect(getResourceStatus({ ...person, invitation: null })).toEqual({
      kind: "not-invited",
    });
  });
});

describe("ResourceStatusBadge", () => {
  it("renders the label of each state and nothing for equipment", () => {
    const { rerender, container } = render(
      <ResourceStatusBadge resource={person} />,
    );
    expect(
      screen.getByText("settings:workspaceResources.status.notInvited"),
    ).toBeInTheDocument();

    rerender(
      <ResourceStatusBadge
        resource={{
          ...person,
          invitation: { status: "expired", expiresAt: "2026-09-01T00:00:00Z" },
        }}
      />,
    );
    expect(
      screen.getByText("settings:workspaceResources.status.invitedExpired"),
    ).toBeInTheDocument();

    rerender(
      <ResourceStatusBadge
        resource={{
          ...person,
          userId: "u1",
          linked: true,
          user: { id: "u1", name: "Ann", email: "a@example.com", image: null },
        }}
      />,
    );
    expect(
      screen.getByText("settings:workspaceResources.status.linkedTo|Ann"),
    ).toBeInTheDocument();

    rerender(
      <ResourceStatusBadge resource={{ ...person, kind: "equipment" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
