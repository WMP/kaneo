import { describe, expect, it } from "vitest";
import { parseInstallArgs } from "./index.js";

describe("parseInstallArgs", () => {
  it("returns defaults for no arguments", () => {
    expect(parseInstallArgs([])).toEqual({
      target: undefined,
      output: undefined,
      name: "kaneo",
      yes: false,
      apiUrl: undefined,
      projectDir: process.cwd(),
      help: false,
    });
  });

  it("parses the --flag=value forms", () => {
    expect(
      parseInstallArgs([
        "--target=custom",
        "--output=/x/mcp.json",
        "--name=my",
        "--api-url=http://a.b",
        "--project-dir=/proj",
        "--yes",
        "--help",
      ]),
    ).toEqual({
      target: "custom",
      output: "/x/mcp.json",
      name: "my",
      yes: true,
      apiUrl: "http://a.b",
      projectDir: "/proj",
      help: true,
    });
  });

  it("parses the space separated forms and short flags", () => {
    expect(
      parseInstallArgs([
        "--output",
        "/x/mcp.json",
        "--project-dir",
        "/proj",
        "-h",
        "-y",
      ]),
    ).toMatchObject({
      output: "/x/mcp.json",
      projectDir: "/proj",
      help: true,
      yes: true,
    });
  });

  it.each(["--target", "--output", "--name", "--api-url", "--project-dir"])(
    "requires a value for %s (missing, or followed by a flag)",
    (flag) => {
      expect(() => parseInstallArgs([flag])).toThrow(
        `${flag} requires a value`,
      );
      expect(() => parseInstallArgs([flag, "--yes"])).toThrow(
        `${flag} requires a value`,
      );
      expect(() => parseInstallArgs([flag, "-y"])).toThrow(
        `${flag} requires a value`,
      );
    },
  );

  it("treats values with a single leading dash and more than one letter as values", () => {
    expect(parseInstallArgs(["--name", "-my-name"]).name).toBe("-my-name");
  });
});
