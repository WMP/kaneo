import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./normalize-base-url.js";

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    // Arrange
    const input = "http://localhost:1337/";

    // Act
    const result = normalizeBaseUrl(input);

    // Assert
    expect(result).toBe("http://localhost:1337");
  });

  it("removes /api suffix from path", () => {
    // Arrange
    const input = "http://localhost:1337/api";

    // Act
    const result = normalizeBaseUrl(input);

    // Assert
    expect(result).toBe("http://localhost:1337");
  });
});

describe("normalizeBaseUrl fallbacks", () => {
  it("keeps a sub-path and strips only a trailing /api", () => {
    expect(normalizeBaseUrl("https://example.com/kaneo/api/")).toBe(
      "https://example.com/kaneo",
    );
    expect(normalizeBaseUrl("https://example.com/kaneo")).toBe(
      "https://example.com/kaneo",
    );
  });

  it("trims whitespace and keeps the port", () => {
    expect(normalizeBaseUrl("  http://localhost:1337  ")).toBe(
      "http://localhost:1337",
    );
  });

  it("falls back to string trimming for values that are not URLs", () => {
    expect(normalizeBaseUrl("kaneo.local/api/")).toBe("kaneo.local");
    expect(normalizeBaseUrl("kaneo.local///")).toBe("kaneo.local");
  });
});
