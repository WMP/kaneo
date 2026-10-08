import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearchText } from "./search-match";

describe("normalizeSearchText", () => {
  it("lower-cases and strips diacritics, including Polish ł", () => {
    expect(normalizeSearchText("Łoś")).toBe("los");
    expect(normalizeSearchText("Żółć Ąę")).toBe("zolc ae");
    expect(normalizeSearchText("Crème Brûlée")).toBe("creme brulee");
  });
});

describe("matchesSearch", () => {
  it("matches everything for an empty or blank query", () => {
    expect(matchesSearch("Alice", "")).toBe(true);
    expect(matchesSearch("Alice", "   ")).toBe(true);
  });

  it("matches the first characters regardless of case and diacritics", () => {
    expect(matchesSearch("Łoś Kowalski", "lo")).toBe(true);
    expect(matchesSearch("Łoś Kowalski", "ŁO")).toBe(true);
    expect(matchesSearch("Alice", "ALI")).toBe(true);
  });

  it("matches inside the text and across words", () => {
    expect(matchesSearch("Anna Kowalska", "kow")).toBe(true);
    expect(matchesSearch("Anna Kowalska", "kow ann")).toBe(true);
  });

  it("rejects text that does not contain every word", () => {
    expect(matchesSearch("Alice", "bob")).toBe(false);
    expect(matchesSearch("Anna Kowalska", "anna nowak")).toBe(false);
  });
});
