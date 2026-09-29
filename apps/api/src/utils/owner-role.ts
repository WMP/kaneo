import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

// "Does this role name have an owner part?" for SQL, with the semantics of
// `isOwnerRole` in `project-access.ts`: the name is a comma-separated list and
// `owner` counts when one of its entries, trimmed, is exactly `owner`.
//
// The pattern is a PostgreSQL ARE, shared by the CHECK constraints on the
// project membership tables (`database/schema.ts`) and by queries such as the
// full-access member list. Keep this file free of database imports: the schema
// file loads it. `tests/api-integration/project-access.test.ts` compares it with
// `isOwnerRole` on a set of spellings.
export const OWNER_PART_PATTERN = "(^|,)\\s*owner\\s*(,|$)";

export function roleHasOwnerPart(column: SQLWrapper): SQL {
  return sql`${column} ~ ${sql.raw(`'${OWNER_PART_PATTERN}'`)}`;
}
