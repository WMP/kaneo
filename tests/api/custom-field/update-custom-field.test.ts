import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  tx: {
    select: vi.fn(),
    selectDistinct: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: { transaction: mocks.transaction },
}));

import updateCustomField from "../../../apps/api/src/custom-field/controllers/update-custom-field";

// select().from().where().limit().for() resolving to `rows` (the locked read).
function mockLockedSelect(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: () => Promise.resolve(rows),
  };
  return chain;
}

// select().from().where() resolving to `rows` (no limit, no lock).
function mockPlainSelect(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

function mockExisting(field: Record<string, unknown> | undefined) {
  mocks.tx.select.mockReturnValueOnce(mockLockedSelect(field ? [field] : []));
}

function mockUsedValues(values: (string | null)[]) {
  mocks.tx.selectDistinct.mockReturnValue(
    mockPlainSelect(values.map((value) => ({ value }))),
  );
}

function mockUpdate(result: (set: Record<string, unknown>) => unknown) {
  const set = vi.fn((values: Record<string, unknown>) => ({
    where: () => ({ returning: async () => [result(values)] }),
  }));
  mocks.tx.update.mockReturnValue({ set });
  return set;
}

const dropdown = {
  id: "field-1",
  projectId: "project-1",
  workspaceId: null,
  name: "Priority",
  type: "dropdown",
  required: false,
  defaultValue: null,
  options: ["low", "mid", "high"],
  optionColors: { low: "green", mid: "yellow" },
  position: 1,
};

describe("updateCustomField", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (run) => run(mocks.tx));
  });

  it("throws 404 when the field does not exist", async () => {
    mockExisting(undefined);

    await expect(
      updateCustomField("missing-id", { name: "New name" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("writes nothing when the merged definition is invalid", async () => {
    mockExisting(dropdown);

    await expect(
      updateCustomField("field-1", { required: true }),
    ).rejects.toBeInstanceOf(HTTPException);
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("rejects removing an option that tasks still use with 409", async () => {
    mockExisting(dropdown);
    mockUsedValues(["mid", "low"]);

    await expect(
      updateCustomField("field-1", { options: ["low", "high"] }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/mid/),
    });
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("writes the merged definition and prunes colors of removed options", async () => {
    mockExisting(dropdown);
    mockUsedValues(["low"]);
    const set = mockUpdate((values) => ({ ...dropdown, ...values }));

    const result = await updateCustomField("field-1", {
      name: " Severity ",
      options: ["low", "high"],
    });

    expect(set).toHaveBeenCalledWith({
      name: "Severity",
      required: false,
      defaultValue: null,
      options: ["low", "high"],
      optionColors: { low: "green" },
    });
    expect(result).toMatchObject({ name: "Severity", scope: "project" });
  });

  it("rejects making a workspace field required while a project hides it", async () => {
    mockExisting({ ...dropdown, projectId: null, workspaceId: "ws-1" });
    mocks.tx.select.mockReturnValueOnce(mockPlainSelect([{ projectId: "p1" }]));

    await expect(
      updateCustomField("field-1", { required: true, defaultValue: "low" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });
});
