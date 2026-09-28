import { describe, expect, it } from "vitest";
import { mergeEffectiveFields } from "../../../apps/api/src/custom-field/effective-fields";

function field(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "field-1",
    projectId: null,
    workspaceId: null,
    name: "Field",
    type: "text",
    required: false,
    defaultValue: null,
    options: null,
    optionColors: null,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: test fixture shortcut
  } as any;
}

describe("mergeEffectiveFields", () => {
  it("returns workspace fields first (by position), then project fields (by position)", () => {
    const workspaceFields = [
      field({ id: "ws-2", workspaceId: "ws", position: 2, name: "Second" }),
      field({ id: "ws-1", workspaceId: "ws", position: 1, name: "First" }),
    ];
    const projectFields = [
      field({ id: "pf-2", projectId: "p", position: 2, name: "P-Second" }),
      field({ id: "pf-1", projectId: "p", position: 1, name: "P-First" }),
    ];

    const result = mergeEffectiveFields(
      workspaceFields,
      projectFields,
      new Set(),
    );

    expect(result.map((f) => f.id)).toEqual(["ws-1", "ws-2", "pf-1", "pf-2"]);
  });

  it("drops a hidden workspace field from the effective set", () => {
    const workspaceFields = [
      field({ id: "ws-visible", workspaceId: "ws", position: 1 }),
      field({ id: "ws-hidden", workspaceId: "ws", position: 2 }),
    ];

    const result = mergeEffectiveFields(
      workspaceFields,
      [],
      new Set(["ws-hidden"]),
    );

    expect(result.map((f) => f.id)).toEqual(["ws-visible"]);
    expect(result[0]?.hidden).toBe(false);
  });

  it("annotates scope, hideable and hidden correctly for the effective set", () => {
    const workspaceFields = [
      field({ id: "ws-optional", workspaceId: "ws", required: false }),
      field({ id: "ws-required", workspaceId: "ws", required: true }),
    ];
    const projectFields = [field({ id: "pf-1", projectId: "p" })];

    const result = mergeEffectiveFields(
      workspaceFields,
      projectFields,
      new Set(),
    );

    const wsOptional = result.find((f) => f.id === "ws-optional");
    const wsRequired = result.find((f) => f.id === "ws-required");
    const projectField = result.find((f) => f.id === "pf-1");

    expect(wsOptional).toMatchObject({
      scope: "workspace",
      hideable: true,
      hidden: false,
    });
    expect(wsRequired).toMatchObject({
      scope: "workspace",
      hideable: false,
      hidden: false,
    });
    expect(projectField).toMatchObject({
      scope: "project",
      hideable: false,
      hidden: false,
    });
  });

  it("keeps every inherited workspace field with its real hidden state when includeHidden is true", () => {
    const workspaceFields = [
      field({ id: "ws-visible", workspaceId: "ws", position: 1 }),
      field({ id: "ws-hidden", workspaceId: "ws", position: 2 }),
    ];

    const result = mergeEffectiveFields(
      workspaceFields,
      [],
      new Set(["ws-hidden"]),
      true,
    );

    expect(result.map((f) => ({ id: f.id, hidden: f.hidden }))).toEqual([
      { id: "ws-visible", hidden: false },
      { id: "ws-hidden", hidden: true },
    ]);
  });
});
