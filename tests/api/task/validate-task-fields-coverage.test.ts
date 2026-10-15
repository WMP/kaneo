import { describe, expect, it } from "vitest";
import {
  assertValidPriority,
  coercePriority,
  coerceStatus,
  isCustomFieldValueEmpty,
  validateCustomFieldValue,
} from "../../../apps/api/src/task/validate-task-fields";

describe("validateCustomFieldValue", () => {
  it.each([
    ["number", "12", null],
    ["number", "-0.5", null],
    ["number", "abc", 'Custom field "F" expects a finite number, got "abc".'],
    [
      "number",
      "Infinity",
      'Custom field "F" expects a finite number, got "Infinity".',
    ],
    ["boolean", "true", null],
    ["boolean", "false", null],
    [
      "boolean",
      "TRUE",
      'Custom field "F" expects "true" or "false", got "TRUE".',
    ],
    ["boolean", "1", 'Custom field "F" expects "true" or "false", got "1".'],
  ] as const)("%s %j", (type, value, expected) => {
    expect(validateCustomFieldValue(value, type, "F")).toBe(expected);
  });

  it("accepts dropdown options given as an array or as a JSON string and rejects others", () => {
    expect(
      validateCustomFieldValue(" b ", "dropdown", "F", ["a", "b"]),
    ).toBeNull();
    expect(
      validateCustomFieldValue("b", "dropdown", "F", '["a","b"]'),
    ).toBeNull();
    expect(validateCustomFieldValue("c", "dropdown", "F", ["a", "b"])).toBe(
      'Custom field "F" expects one of: a, b, got "c".',
    );
    expect(validateCustomFieldValue("a", "dropdown", "F", "{not json")).toBe(
      'Custom field "F" has invalid dropdown options.',
    );
  });

  it("validates multiselect JSON, emptiness and membership, with options as array or string", () => {
    expect(
      validateCustomFieldValue('["a"]', "multiselect", "F", ["a", "b"]),
    ).toBeNull();
    expect(
      validateCustomFieldValue('["a","b"]', "multiselect", "F", '["a","b"]'),
    ).toBeNull();
    expect(
      validateCustomFieldValue('["a"]', "multiselect", "F", "{not json"),
    ).toBe('Custom field "F" has invalid multiselect options.');
    expect(validateCustomFieldValue("nope", "multiselect", "F", ["a"])).toBe(
      'Custom field "F" expects a JSON array of selected options, got "nope".',
    );
    expect(validateCustomFieldValue("[]", "multiselect", "F", ["a"])).toBe(
      'Custom field "F" expects at least one selected option.',
    );
    expect(validateCustomFieldValue('"a"', "multiselect", "F", ["a"])).toBe(
      'Custom field "F" expects at least one selected option.',
    );
    expect(
      validateCustomFieldValue('["a","z",3]', "multiselect", "F", ["a"]),
    ).toBe(
      'Custom field "F" expects values from: a, got invalid value(s): z, 3.',
    );
  });

  it.each([
    ["2026-02-28", null],
    ["2026-02-28T10:00:00Z", null],
    ["2026-02-28T10:00:00.123+02:00", null],
    [
      "28/02/2026",
      'Custom field "F" expects a date in YYYY-MM-DD or ISO 8601 format, got "28/02/2026".',
    ],
    [
      "2026-02-30",
      'Custom field "F" expects a valid ISO 8601 date, got "2026-02-30".',
    ],
    [
      "2026-13-01",
      'Custom field "F" expects a valid ISO 8601 date, got "2026-13-01".',
    ],
  ])("date %j", (value, expected) => {
    expect(validateCustomFieldValue(value, "date", "F")).toBe(expected);
  });
});

describe("isCustomFieldValueEmpty", () => {
  it("treats blank text and an empty multiselect array as empty, and unparseable multiselect text as not empty", () => {
    expect(isCustomFieldValueEmpty("   ", "number")).toBe(true);
    expect(isCustomFieldValueEmpty("0", "number")).toBe(false);
    expect(isCustomFieldValueEmpty("[]", "multiselect")).toBe(true);
    expect(isCustomFieldValueEmpty('["a"]', "multiselect")).toBe(false);
    expect(isCustomFieldValueEmpty("garbage", "multiselect")).toBe(false);
  });
});

describe("priority and status helpers", () => {
  it("assertValidPriority lists the allowed values for an unknown priority", () => {
    expect(() => assertValidPriority("medium")).not.toThrow();
    expect(() => assertValidPriority("critical")).toThrowError(
      'Invalid priority "critical". Valid values: no-priority, low, medium, high, urgent',
    );
  });

  it("coercePriority maps an unknown priority to no-priority with a warning", () => {
    expect(coercePriority("high")).toEqual({ priority: "high" });
    expect(coercePriority("whatever")).toEqual({
      priority: "no-priority",
      warning: 'Unknown priority "whatever" mapped to "no-priority"',
    });
  });

  it("coerceStatus maps an unknown status to planned with a warning", () => {
    expect(coerceStatus("done", ["to-do", "done"])).toEqual({ status: "done" });
    expect(coerceStatus("blocked", ["to-do", "done"])).toEqual({
      status: "planned",
      warning: 'Unknown status "blocked" mapped to "planned"',
    });
  });
});
