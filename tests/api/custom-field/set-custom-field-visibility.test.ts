import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chain } from "./support/chain";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: mocks.select,
    insert: mocks.insert,
    delete: mocks.delete,
  },
}));

import setCustomFieldVisibility from "../../../apps/api/src/custom-field/controllers/set-custom-field-visibility";

function field(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "field-1",
    projectId: null,
    workspaceId: "ws-1",
    name: "Priority",
    type: "text",
    required: false,
    defaultValue: null,
    options: null,
    optionColors: null,
    position: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("setCustomFieldVisibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects hiding a required workspace field", async () => {
    mocks.select
      .mockReturnValueOnce(chain([{ workspaceId: "ws-1" }])) // project -> workspace
      .mockReturnValueOnce(chain([field({ required: true })])); // field lookup

    await expect(
      setCustomFieldVisibility("project-1", "field-1", true),
    ).rejects.toThrow(HTTPException);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("hides an optional workspace field", async () => {
    mocks.select
      .mockReturnValueOnce(chain([{ workspaceId: "ws-1" }]))
      .mockReturnValueOnce(chain([field({ required: false })]));
    mocks.insert.mockReturnValueOnce(chain(undefined));

    const result = await setCustomFieldVisibility("project-1", "field-1", true);

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: "field-1",
      scope: "workspace",
      hideable: true,
      hidden: true,
    });
  });

  it("shows a previously hidden field", async () => {
    mocks.select
      .mockReturnValueOnce(chain([{ workspaceId: "ws-1" }]))
      .mockReturnValueOnce(chain([field({ required: false })]));
    mocks.delete.mockReturnValueOnce(chain(undefined));

    const result = await setCustomFieldVisibility(
      "project-1",
      "field-1",
      false,
    );

    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ hidden: false });
  });

  it("rejects a field that isn't a workspace-level field of this project's workspace", async () => {
    mocks.select
      .mockReturnValueOnce(chain([{ workspaceId: "ws-1" }]))
      .mockReturnValueOnce(chain([field({ workspaceId: "other-ws" })]));

    await expect(
      setCustomFieldVisibility("project-1", "field-1", true),
    ).rejects.toThrow(HTTPException);
  });

  it("rejects a project-level field (not a workspace field at all)", async () => {
    mocks.select
      .mockReturnValueOnce(chain([{ workspaceId: "ws-1" }]))
      .mockReturnValueOnce(
        chain([field({ workspaceId: null, projectId: "project-1" })]),
      );

    await expect(
      setCustomFieldVisibility("project-1", "field-1", true),
    ).rejects.toThrow(HTTPException);
  });
});
