import { supportedLocales } from "@i18n/resources";
import { describe, expect, it } from "vitest";
import { resolveDateFnsLocale } from "./date-fns-locale";

describe("resolveDateFnsLocale", () => {
  it("maps every supported app locale to a date-fns locale", () => {
    for (const locale of supportedLocales) {
      const resolved = resolveDateFnsLocale(locale);
      expect(resolved).toBeDefined();
      expect(typeof resolved.code).toBe("string");
    }
  });

  it("returns the Polish locale for pl-PL", () => {
    expect(resolveDateFnsLocale("pl-PL").code).toBe("pl");
  });

  it("falls back to the base language subtag when the exact tag is unknown", () => {
    // "pl" (no region) is not a key, but shares the "pl-" base with pl-PL.
    expect(resolveDateFnsLocale("pl").code).toBe("pl");
    expect(resolveDateFnsLocale("de-AT").code).toBe("de");
  });

  it("falls back to en-US for an unknown language and for no argument", () => {
    expect(resolveDateFnsLocale("xx-YY").code).toBe("en-US");
    expect(resolveDateFnsLocale().code).toBe("en-US");
    expect(resolveDateFnsLocale("").code).toBe("en-US");
  });
});
