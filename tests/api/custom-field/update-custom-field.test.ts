import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: mocks.select,
    update: mocks.update,
  },
}));

import updateCustomField from "../../../apps/api/src/custom-field/controllers/update-custom-field";

function mockExisting(field: Record<string, unknown> | undefined) {
  const limit = vi.fn().mockResolvedValue(field ? [field] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  mocks.select.mockReturnValue({ from });
}

function mockUpdated(updated: Record<string, unknown> | undefined) {
  const returning = vi.fn().mockResolvedValue(updated ? [updated] : []);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  mocks.update.mockReturnValue({ set });
}

describe("updateCustomField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 404 when the field does not exist", async () => {
    mockExisting(undefined);

    await expect(updateCustomField("missing-id", "New name")).rejects.toThrow(
      HTTPException,
    );
  });

  it("rejects an empty name", async () => {
    mockExisting({ id: "field-1", type: "text", options: null });

    await expect(updateCustomField("field-1", "   ")).rejects.toThrow(
      HTTPException,
    );
  });

  it("rejects option colors on a non-dropdown field", async () => {
    mockExisting({ id: "field-1", type: "text", options: null });

    await expect(
      updateCustomField("field-1", undefined, { low: "green" }),
    ).rejects.toThrow(/dropdown/);
  });

  it("rejects option colors that reference an unknown option", async () => {
    mockExisting({
      id: "field-1",
      type: "dropdown",
      options: ["low", "high"],
    });

    await expect(
      updateCustomField("field-1", undefined, { medium: "yellow" }),
    ).rejects.toThrow(/medium/);
  });

  it("allows clearing option colors with null", async () => {
    mockExisting({
      id: "field-1",
      type: "dropdown",
      options: ["low", "high"],
    });
    mockUpdated({
      id: "field-1",
      type: "dropdown",
      options: ["low", "high"],
      optionColors: null,
    });

    await expect(
      updateCustomField("field-1", undefined, null),
    ).resolves.toMatchObject({ optionColors: null });
  });

  it("updates the name and option colors for a valid dropdown field", async () => {
    mockExisting({
      id: "field-1",
      type: "dropdown",
      options: ["low", "high"],
      name: "Priority",
    });
    mockUpdated({
      id: "field-1",
      type: "dropdown",
      options: ["low", "high"],
      name: "Severity",
      optionColors: { low: "green", high: "red" },
    });

    const result = await updateCustomField("field-1", "Severity", {
      low: "green",
      high: "red",
    });

    expect(result).toMatchObject({
      name: "Severity",
      optionColors: { low: "green", high: "red" },
    });
    expect(mocks.update).toHaveBeenCalled();
  });
});
