import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The upstream-compatible adapters in apps/api/src/project-access delegate to
// the fork's access functions; they must never grant more than those do.
const resolveProjectAccessMap = vi.fn();
const resolveProjectAccess = vi.fn();
const isFullAccess = vi.fn();
const filterUsers = vi.fn();

vi.mock("../../../apps/api/src/utils/project-access", () => ({
  PROJECT_ACCESS_DENIED_MESSAGE: "You don't have access to this project",
  isOwnerRole: (role: string) =>
    role
      .split(",")
      .map((part) => part.trim())
      .includes("owner"),
  isFullAccess: (...args: unknown[]) => isFullAccess(...args),
  resolveProjectAccess: (...args: unknown[]) => resolveProjectAccess(...args),
  resolveProjectAccessMap: (...args: unknown[]) =>
    resolveProjectAccessMap(...args),
}));
vi.mock("../../../apps/api/src/utils/project-scope-filters", () => ({
  filterUsersWithProjectAccess: (...args: unknown[]) => filterUsers(...args),
}));

const { assertProjectAccess } =
  await import("../../../apps/api/src/project-access/assert-project-access");
const { findInaccessibleProjectIds } =
  await import("../../../apps/api/src/project-access/find-inaccessible-project-ids");
const { canAccessProject } =
  await import("../../../apps/api/src/project-access/can-access-project");
const { findAccessibleProjects } =
  await import("../../../apps/api/src/project-access/find-accessible-projects");
const { filterUsersWithProjectAccess } =
  await import("../../../apps/api/src/project-access/filter-users-with-project-access");
const { isProjectAccessRestricted } =
  await import("../../../apps/api/src/project-access/is-project-access-restricted");
const { isOwnerRole } =
  await import("../../../apps/api/src/project-access/is-owner-role");

const access = (workspaceId: string) => ({ workspaceId });

describe("upstream project-access adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assertProjectAccess rejects when one project is not accessible", async () => {
    resolveProjectAccessMap.mockResolvedValue(new Map([["p1", access("w1")]]));
    await expect(assertProjectAccess("u1", ["p1", "p2"])).rejects.toMatchObject(
      { status: 403 },
    );
    resolveProjectAccessMap.mockResolvedValue(new Map([["p1", access("w1")]]));
    await expect(assertProjectAccess("u1", "p1")).resolves.toBeUndefined();
  });

  it("findInaccessibleProjectIds lists unknown and denied ids once", async () => {
    resolveProjectAccessMap.mockResolvedValue(new Map([["p1", access("w1")]]));
    expect(await findInaccessibleProjectIds("u1", ["p1", "p2", "p2"])).toEqual([
      "p2",
    ]);
  });

  it("canAccessProject follows resolveProjectAccess", async () => {
    resolveProjectAccess.mockResolvedValueOnce(null);
    expect(await canAccessProject("u1", "p1")).toBe(false);
    resolveProjectAccess.mockResolvedValueOnce(access("w1"));
    expect(await canAccessProject("u1", "p1")).toBe(true);
  });

  it("findAccessibleProjects maps project ids to workspace ids", async () => {
    resolveProjectAccessMap.mockResolvedValue(new Map([["p1", access("w1")]]));
    expect(await findAccessibleProjects("u1", ["p1", "p2"])).toEqual(
      new Map([["p1", "w1"]]),
    );
  });

  it("filterUsersWithProjectAccess passes distinct ids to the fork", async () => {
    filterUsers.mockResolvedValue(new Set(["a"]));
    expect(
      await filterUsersWithProjectAccess(new Set(["a", "b"]), "p1"),
    ).toEqual(new Set(["a"]));
    expect(filterUsers).toHaveBeenCalledWith(["a", "b"], "p1");
  });

  it("treats every member without full access as restricted", async () => {
    isFullAccess.mockResolvedValueOnce(false);
    expect(await isProjectAccessRestricted("w1", "u1")).toBe(true);
    isFullAccess.mockResolvedValueOnce(true);
    expect(await isProjectAccessRestricted("w1", "u1")).toBe(false);
    expect(isFullAccess).toHaveBeenCalledWith("u1", "w1");
  });

  it("isOwnerRole accepts nullable and composite roles", () => {
    expect(isOwnerRole(null)).toBe(false);
    expect(isOwnerRole("admin, owner")).toBe(true);
    expect(isOwnerRole("member")).toBe(false);
  });
});
