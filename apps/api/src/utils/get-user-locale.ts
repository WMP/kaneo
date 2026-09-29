import { inArray } from "drizzle-orm";
import db, { schema } from "../database";

// The stored interface locale of the account with this email, if any. Better
// Auth lower-cases emails, so the lower-cased address is what matches; the
// address as given is tried as well for rows written before that.
export async function getUserLocale(email: string): Promise<string | null> {
  const [user] = await db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(inArray(schema.userTable.email, [email.toLowerCase(), email]))
    .limit(1);

  return user?.locale ?? null;
}
