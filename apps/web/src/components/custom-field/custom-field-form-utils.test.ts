import { describe, expect, it } from "vitest";
import {
  buildUpdatePayload,
  canSaveDraft,
  draftFromField,
  parseOptionsText,
  pruneDefaultToOptions,
  readStoredDefault,
} from "./custom-field-form-utils";
import type { CustomFieldDefinition } from "./types";

function field(
  overrides: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    id: "field-1",
    projectId: "project-1",
    workspaceId: null,
    scope: "project",
    hideable: false,
    hidden: false,
    name: "Tags",
    type: "multiselect",
    required: false,
    defaultValue: '["a"]',
    options: ["a", "b", "c"],
    optionColors: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("parseOptionsText", () => {
  it("trims, drops blanks and de-duplicates", () => {
    expect(parseOptionsText(" b, a ,,b , ")).toEqual(["b", "a"]);
  });
});

describe("readStoredDefault / pruneDefaultToOptions", () => {
  it("reads a multiselect default as an array and tolerates bad JSON", () => {
    expect(readStoredDefault("multiselect", '["a","b"]')).toEqual(["a", "b"]);
    expect(readStoredDefault("multiselect", "not json")).toEqual([]);
    expect(readStoredDefault("multiselect", null)).toEqual([]);
    expect(readStoredDefault("text", null)).toBe("");
  });

  it("drops default choices that are no longer options", () => {
    expect(
      pruneDefaultToOptions("multiselect", ["a", "z"], ["a", "b"]),
    ).toEqual(["a"]);
    expect(pruneDefaultToOptions("dropdown", "z", ["a"])).toBe("");
    expect(pruneDefaultToOptions("text", "z", [])).toBe("z");
  });
});

describe("buildUpdatePayload", () => {
  it("is empty for an untouched draft", () => {
    const f = field();
    expect(buildUpdatePayload(f, draftFromField(f))).toEqual({});
  });

  it("sends only what changed", () => {
    const f = field();
    const draft = { ...draftFromField(f), name: " Labels ", required: true };
    expect(buildUpdatePayload(f, draft)).toEqual({
      name: "Labels",
      required: true,
    });
  });

  it("sends the replacement options and a default pruned to them", () => {
    const f = field({ defaultValue: '["a","b"]' });
    const draft = { ...draftFromField(f), optionsText: "b, c, d" };
    expect(buildUpdatePayload(f, draft)).toEqual({
      options: ["b", "c", "d"],
      defaultValue: '["b"]',
    });
  });

  it("clears a default with null", () => {
    const f = field();
    expect(
      buildUpdatePayload(f, { ...draftFromField(f), defaultValue: [] }),
    ).toEqual({ defaultValue: null });
  });

  it("never sends options for a type without options", () => {
    const f = field({ type: "text", options: null, defaultValue: null });
    const draft = { ...draftFromField(f), optionsText: "x, y" };
    expect(buildUpdatePayload(f, draft)).toEqual({});
  });
});

describe("canSaveDraft", () => {
  it("applies the create form's gate", () => {
    const f = field();
    const draft = draftFromField(f);
    expect(canSaveDraft(f, draft)).toBe(true);
    expect(canSaveDraft(f, { ...draft, name: " " })).toBe(false);
    expect(canSaveDraft(f, { ...draft, optionsText: "a, a" })).toBe(false);
    expect(
      canSaveDraft(f, { ...draft, required: true, defaultValue: [] }),
    ).toBe(false);
  });
});
