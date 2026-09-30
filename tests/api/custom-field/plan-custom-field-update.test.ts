import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import {
  type CustomFieldUpdateExisting,
  normalizeOptions,
  planCustomFieldUpdate,
} from "../../../apps/api/src/custom-field/plan-custom-field-update";

function field(
  overrides: Partial<CustomFieldUpdateExisting> = {},
): CustomFieldUpdateExisting {
  return {
    name: "Priority",
    type: "dropdown",
    required: false,
    defaultValue: null,
    options: ["low", "high"],
    optionColors: null,
    ...overrides,
  };
}

function rejection(run: () => unknown): HTTPException {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    return error as HTTPException;
  }
  throw new Error("expected the plan to be rejected");
}

describe("normalizeOptions", () => {
  it("trims, drops blanks and de-duplicates in first-seen order", () => {
    expect(normalizeOptions([" b ", "a", "b", "", "  ", "a "])).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("planCustomFieldUpdate", () => {
  it("keeps every stored value when the patch is empty", () => {
    expect(
      planCustomFieldUpdate(
        field({
          required: true,
          defaultValue: "low",
          optionColors: { low: "green" },
        }),
        {},
      ),
    ).toEqual({
      name: "Priority",
      required: true,
      defaultValue: "low",
      options: ["low", "high"],
      optionColors: { low: "green" },
      removedOptions: [],
    });
  });

  it("trims the name and rejects an empty one", () => {
    expect(planCustomFieldUpdate(field(), { name: "  Severity " }).name).toBe(
      "Severity",
    );
    expect(
      rejection(() => planCustomFieldUpdate(field(), { name: " " })).status,
    ).toBe(400);
  });

  it("requires a default value for a required field", () => {
    const error = rejection(() =>
      planCustomFieldUpdate(field(), { required: true }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/default value/);

    expect(
      planCustomFieldUpdate(field(), { required: true, defaultValue: "low" })
        .required,
    ).toBe(true);
  });

  it("rejects clearing the default of a required field", () => {
    expect(
      rejection(() =>
        planCustomFieldUpdate(field({ required: true, defaultValue: "low" }), {
          defaultValue: null,
        }),
      ).status,
    ).toBe(400);
  });

  it("clears the default with null or a blank string", () => {
    const existing = field({ defaultValue: "low" });
    expect(
      planCustomFieldUpdate(existing, { defaultValue: null }).defaultValue,
    ).toBeNull();
    expect(
      planCustomFieldUpdate(existing, { defaultValue: "  " }).defaultValue,
    ).toBeNull();
  });

  it("rejects a default that is not one of the (new) options", () => {
    expect(
      rejection(() => planCustomFieldUpdate(field(), { defaultValue: "mid" }))
        .message,
    ).toMatch(/one of the dropdown options/);

    // The stored default must also survive an options change.
    expect(
      rejection(() =>
        planCustomFieldUpdate(field({ defaultValue: "low" }), {
          options: ["high", "urgent"],
        }),
      ).message,
    ).toMatch(/one of the dropdown options/);
  });

  it("validates the default against the field type", () => {
    expect(
      rejection(() =>
        planCustomFieldUpdate(field({ type: "number", options: null }), {
          defaultValue: "abc",
        }),
      ).message,
    ).toMatch(/valid number/);
    expect(
      rejection(() =>
        planCustomFieldUpdate(field({ type: "date", options: null }), {
          defaultValue: "2026-02-30",
        }),
      ).status,
    ).toBe(400);
  });

  it("normalizes replacement options and reports the removed ones", () => {
    const plan = planCustomFieldUpdate(
      field({ options: ["low", "mid", "high"] }),
      { options: [" high ", "low", "low", "urgent", ""] },
    );
    expect(plan.options).toEqual(["high", "low", "urgent"]);
    expect(plan.removedOptions).toEqual(["mid"]);
  });

  it("enforces the option count of each type", () => {
    expect(
      rejection(() => planCustomFieldUpdate(field(), { options: [" ", ""] }))
        .message,
    ).toMatch(/at least one option/);

    const multiselect = field({
      type: "multiselect",
      options: ["a", "b", "c"],
    });
    expect(
      rejection(() =>
        planCustomFieldUpdate(multiselect, { options: ["a", "a", " a"] }),
      ).message,
    ).toMatch(/at least 2 options/);
    expect(
      planCustomFieldUpdate(multiselect, { options: ["a", "b"] })
        .removedOptions,
    ).toEqual(["c"]);
  });

  it("rejects options on a type that has none and keeps it option-free", () => {
    const text = field({ type: "text", options: null });
    expect(
      rejection(() => planCustomFieldUpdate(text, { options: ["a"] })).message,
    ).toMatch(/dropdown and multiselect/);
    expect(planCustomFieldUpdate(text, { name: "Notes" }).options).toBeNull();
  });

  it("prunes colors of removed options unless colors are sent", () => {
    const existing = field({ optionColors: { low: "green", high: "red" } });

    expect(
      planCustomFieldUpdate(existing, { options: ["low", "urgent"] })
        .optionColors,
    ).toEqual({ low: "green" });
    expect(
      planCustomFieldUpdate(existing, { options: ["urgent"] }).optionColors,
    ).toBeNull();
    expect(
      planCustomFieldUpdate(existing, {
        options: ["low", "urgent"],
        optionColors: { urgent: "blue" },
      }).optionColors,
    ).toEqual({ urgent: "blue" });
    expect(
      planCustomFieldUpdate(existing, { optionColors: null }).optionColors,
    ).toBeNull();
  });

  it("rejects explicit colors for an option that is not in the new list", () => {
    expect(
      rejection(() =>
        planCustomFieldUpdate(field(), {
          options: ["low", "urgent"],
          optionColors: { high: "red" },
        }),
      ).message,
    ).toMatch(/high/);
  });

  it("rejects option colors on a non-dropdown field", () => {
    expect(
      rejection(() =>
        planCustomFieldUpdate(field({ type: "text", options: null }), {
          optionColors: { a: "red" },
        }),
      ).message,
    ).toMatch(/dropdown/);
  });

  it("validates a multiselect default against the new options", () => {
    const multiselect = field({
      type: "multiselect",
      options: ["a", "b", "c"],
      defaultValue: '["a"]',
    });
    expect(
      planCustomFieldUpdate(multiselect, { defaultValue: '["b","c"]' })
        .defaultValue,
    ).toBe('["b","c"]');
    expect(
      rejection(() =>
        planCustomFieldUpdate(multiselect, { options: ["b", "c"] }),
      ).status,
    ).toBe(400);
    expect(
      planCustomFieldUpdate(multiselect, { defaultValue: "[]" }).defaultValue,
    ).toBeNull();
  });
});
