import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveCustomFieldDefinitions: vi.fn(),
}));

vi.mock("../../../apps/api/src/custom-field/effective-fields", () => ({
  getEffectiveCustomFieldDefinitions: mocks.getEffectiveCustomFieldDefinitions,
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: {},
}));

import { assertRequiredCustomFields } from "../../../apps/api/src/task/validate-task-fields";

const requiredInheritedField = {
  id: "ws-required",
  name: "Compliance Tag",
  type: "text",
  required: true,
  defaultValue: null,
  options: null,
  workspaceId: "ws-1",
  projectId: null,
  scope: "workspace" as const,
  hideable: false,
  hidden: false,
  position: 1,
  optionColors: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("assertRequiredCustomFields with an inherited workspace field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when a required inherited workspace field has no value and no default", async () => {
    mocks.getEffectiveCustomFieldDefinitions.mockResolvedValue([
      requiredInheritedField,
    ]);

    await expect(assertRequiredCustomFields("project-1", [])).rejects.toThrow(
      HTTPException,
    );
    await expect(assertRequiredCustomFields("project-1", [])).rejects.toThrow(
      /Compliance Tag/,
    );
  });

  it("accepts a required inherited workspace field satisfied by its default value", async () => {
    mocks.getEffectiveCustomFieldDefinitions.mockResolvedValue([
      { ...requiredInheritedField, defaultValue: "confidential" },
    ]);

    await expect(
      assertRequiredCustomFields("project-1", []),
    ).resolves.toBeUndefined();
  });

  it("accepts a required inherited workspace field satisfied by a provided value", async () => {
    mocks.getEffectiveCustomFieldDefinitions.mockResolvedValue([
      requiredInheritedField,
    ]);

    await expect(
      assertRequiredCustomFields("project-1", [
        { fieldId: "ws-required", value: "confidential" },
      ]),
    ).resolves.toBeUndefined();
  });

  it("rejects a value for a field outside the project's effective set", async () => {
    mocks.getEffectiveCustomFieldDefinitions.mockResolvedValue([]);

    await expect(
      assertRequiredCustomFields("project-1", [
        { fieldId: "some-other-field", value: "x" },
      ]),
    ).rejects.toThrow(/does not belong to this project/);
  });
});
