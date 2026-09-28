import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { validateOptionColors } from "../../../apps/api/src/custom-field/validate-option-colors";

describe("validateOptionColors", () => {
  it("allows colors whose keys are a subset of the field's options", () => {
    expect(() =>
      validateOptionColors(["low", "medium", "high"], {
        low: "green",
        high: "red",
      }),
    ).not.toThrow();
  });

  it("allows a color for every option", () => {
    expect(() =>
      validateOptionColors(["low", "high"], { low: "green", high: "red" }),
    ).not.toThrow();
  });

  it("rejects a color key that isn't one of the field's options", () => {
    expect(() =>
      validateOptionColors(["low", "high"], { medium: "yellow" }),
    ).toThrow(HTTPException);

    try {
      validateOptionColors(["low", "high"], { medium: "yellow" });
      throw new Error("expected validateOptionColors to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).message).toContain("medium");
    }
  });

  it("reports every unknown key at once", () => {
    try {
      validateOptionColors(["low"], { medium: "yellow", extra: "blue" });
      throw new Error("expected validateOptionColors to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).message).toContain("medium");
      expect((error as HTTPException).message).toContain("extra");
    }
  });

  it("does nothing when optionColors is null or undefined", () => {
    expect(() => validateOptionColors(["low"], null)).not.toThrow();
    expect(() => validateOptionColors(["low"], undefined)).not.toThrow();
  });

  it("treats an empty optionColors object as valid", () => {
    expect(() => validateOptionColors(["low"], {})).not.toThrow();
  });

  it("trims option values before comparing, mirroring create-custom-field's own option normalization", () => {
    expect(() =>
      validateOptionColors([" low ", "high"], { low: "green" }),
    ).not.toThrow();
  });

  it("treats missing or malformed options as having no valid keys", () => {
    expect(() => validateOptionColors(null, { low: "green" })).toThrow(
      HTTPException,
    );
    expect(() => validateOptionColors(undefined, { low: "green" })).toThrow(
      HTTPException,
    );
    expect(() =>
      validateOptionColors("not-an-array", { low: "green" }),
    ).toThrow(HTTPException);
    expect(() =>
      validateOptionColors([1, 2, "low"], { low: "green" }),
    ).not.toThrow();
  });
});
