import { beforeEach, describe, expect, it, vi } from "vitest";
import getCustomFieldsByProject from "./get-custom-fields-by-project";

const { getRequest } = vi.hoisted(() => ({ getRequest: vi.fn() }));
vi.mock("@kaneo/libs", () => ({
  client: {
    "custom-field": {
      project: { ":projectId": { $get: getRequest } },
    },
  },
}));

beforeEach(() => vi.resetAllMocks());

describe("getCustomFieldsByProject", () => {
  it("requests the effective field set by default — every task-rendering call site (task detail, create-task modal, board/backlog badges) relies on this", async () => {
    getRequest.mockResolvedValue(Response.json([]));

    await getCustomFieldsByProject({ projectId: "project-1" });

    expect(getRequest).toHaveBeenCalledWith({
      param: { projectId: "project-1" },
      query: {},
    });
  });

  it("requests every inherited field (hidden included) when includeHidden is set, for the project's field-visibility editor", async () => {
    getRequest.mockResolvedValue(Response.json([]));

    await getCustomFieldsByProject({
      projectId: "project-1",
      includeHidden: true,
    });

    expect(getRequest).toHaveBeenCalledWith({
      param: { projectId: "project-1" },
      query: { includeHidden: "true" },
    });
  });
});
