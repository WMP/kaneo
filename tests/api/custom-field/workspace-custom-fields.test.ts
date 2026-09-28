import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chain } from "./support/chain";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: mocks.select,
    transaction: mocks.transaction,
  },
}));

import createWorkspaceCustomField from "../../../apps/api/src/custom-field/controllers/create-workspace-custom-field";
import getWorkspaceCustomFields from "../../../apps/api/src/custom-field/controllers/get-workspace-custom-fields";

function row(overrides: Partial<Record<string, unknown>> = {}) {
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

describe("createWorkspaceCustomField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 404 when the workspace does not exist", async () => {
    mocks.select.mockReturnValueOnce(chain([]));

    await expect(
      createWorkspaceCustomField("missing-ws", "Priority", "text", false),
    ).rejects.toThrow(HTTPException);
  });

  it("creates a workspace-level field, annotated as workspace-scoped and hideable", async () => {
    const created = row({ position: 4 });

    mocks.select
      // workspace existence check
      .mockReturnValueOnce(chain([{ id: "ws-1" }]))
      // max position lookup
      .mockReturnValueOnce(chain([{ maxPosition: 3 }]));
    mocks.transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert: () => chain([created]) }),
    );

    const result = await createWorkspaceCustomField(
      "ws-1",
      "Priority",
      "text",
      false,
    );

    expect(result).toMatchObject({
      id: "field-1",
      workspaceId: "ws-1",
      projectId: null,
      scope: "workspace",
      hideable: true,
      hidden: false,
      position: 4,
    });
  });

  it("marks a required workspace field as not hideable", async () => {
    const created = row({ required: true, defaultValue: "high" });

    mocks.select
      .mockReturnValueOnce(chain([{ id: "ws-1" }]))
      .mockReturnValueOnce(chain([{ maxPosition: 0 }]));
    mocks.transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert: () => chain([created]), select: () => chain([]) }),
    );

    const result = await createWorkspaceCustomField(
      "ws-1",
      "Priority",
      "text",
      true,
      "high",
    );

    expect(result).toMatchObject({ scope: "workspace", hideable: false });
  });

  it("rejects a required field with no default value", async () => {
    mocks.select.mockReturnValueOnce(chain([{ id: "ws-1" }]));

    await expect(
      createWorkspaceCustomField("ws-1", "Priority", "text", true),
    ).rejects.toThrow(HTTPException);
  });
});

describe("getWorkspaceCustomFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists workspace-level fields annotated with scope and hideable", async () => {
    mocks.select.mockReturnValueOnce(
      chain([
        row({ id: "f-1", position: 1, required: false }),
        row({ id: "f-2", position: 2, required: true }),
      ]),
    );

    const result = await getWorkspaceCustomFields("ws-1");

    expect(result).toEqual([
      expect.objectContaining({
        id: "f-1",
        scope: "workspace",
        hideable: true,
        hidden: false,
      }),
      expect.objectContaining({
        id: "f-2",
        scope: "workspace",
        hideable: false,
        hidden: false,
      }),
    ]);
  });
});
