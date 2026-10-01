import { and, asc, eq, gt, ilike, isNull, not, or, sql } from "drizzle-orm";
import db from "../../database";
import { userTable, workspaceUserTable } from "../../database/schema";
import { codedError } from "../../utils/coded-error";
import { isUserDirectoryEnabled } from "../../utils/user-directory";

export const USER_DIRECTORY_MIN_QUERY_LENGTH = 2;
export const USER_DIRECTORY_MAX_RESULTS = 20;

export const USER_DIRECTORY_ERROR_CODES = {
  disabled: "USER_DIRECTORY_DISABLED",
  queryTooShort: "QUERY_TOO_SHORT",
} as const;

// `%`, `_` and the escape character itself stand for themselves in a search.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// The feature flag, used by the route before anything else: the directory
// reveals that an account exists, so an instance that switched it off answers
// 403 to everybody.
export function assertUserDirectoryEnabled(): void {
  if (!isUserDirectoryEnabled()) {
    throw codedError(
      403,
      USER_DIRECTORY_ERROR_CODES.disabled,
      "The user directory is disabled on this instance",
    );
  }
}

// Accounts of the instance whose name or email contains `query`, for the
// "add people" dialog of a workspace. Deliberately narrow: at least two
// characters, at most 20 results, only id, name, email and image, no anonymous
// (guest) accounts, no account that is banned right now, and nobody who already
// is a member of this workspace (they have nothing to be added to). The
// caller's right to use it (`member:create` in the workspace role) is decided by
// the route.
async function searchUserDirectory(workspaceId: string, rawQuery: string) {
  const query = rawQuery.trim();
  if (query.length < USER_DIRECTORY_MIN_QUERY_LENGTH) {
    throw codedError(
      400,
      USER_DIRECTORY_ERROR_CODES.queryTooShort,
      `Type at least ${USER_DIRECTORY_MIN_QUERY_LENGTH} characters`,
    );
  }
  const pattern = `%${escapeLike(query)}%`;

  return db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
    })
    .from(userTable)
    .where(
      and(
        or(ilike(userTable.name, pattern), ilike(userTable.email, pattern)),
        or(isNull(userTable.isAnonymous), eq(userTable.isAnonymous, false)),
        or(
          isNull(userTable.banned),
          eq(userTable.banned, false),
          and(
            sql`${userTable.banExpires} is not null`,
            not(gt(userTable.banExpires, sql`now()`)),
          ),
        ),
        sql`not exists (
          select 1 from ${workspaceUserTable}
          where ${workspaceUserTable.workspaceId} = ${workspaceId}
            and ${workspaceUserTable.userId} = ${userTable.id}
        )`,
      ),
    )
    .orderBy(asc(userTable.name), asc(userTable.id))
    .limit(USER_DIRECTORY_MAX_RESULTS);
}

export default searchUserDirectory;
