import { describe, expect, it } from "vitest";
import {
  isOwnerRole,
  projectRoleStatements,
} from "../../../apps/api/src/utils/project-access";

// The database CHECK keeps owner out of stored project roles; this runtime
// guard is the second line, so it must recognise the same spellings.
const OWNER_SPELLINGS = [
  "owner",
  " owner ",
  "admin,owner",
  "member, owner",
  "admin,\towner",
  "owner,\nadmin",
  "viewer,\t owner \t,member",
];

describe("owner is never a project role", () => {
  it.each(OWNER_SPELLINGS)("isOwnerRole(%j)", (role) => {
    expect(isOwnerRole(role)).toBe(true);
  });

  it.each(["coowner", "ownership", "admin", "owners", "", "my-owner"])(
    "isOwnerRole(%j) is false",
    (role) => {
      expect(isOwnerRole(role)).toBe(false);
    },
  );

  it.each(OWNER_SPELLINGS)(
    "projectRoleStatements(%j) grants nothing without a lookup",
    async (role) => {
      // Answers before any catalog lookup, so no database is needed.
      expect(await projectRoleStatements("workspace", role)).toBeNull();
    },
  );
});
