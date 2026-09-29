import { eq } from "drizzle-orm";
import db from "../database";
import { apikeyTable, sessionTable } from "../database/schema";

// What authenticated a WebSocket upgrade. A socket outlives the request that
// opened it, so the credential is looked at again when access is revalidated:
// a session that was revoked or expired, or an API key that was disabled,
// deleted or expired, must not keep a project socket open.
export type ConnectionCredential = {
  /** Set for a socket opened with an API key. */
  apiKeyId?: string;
  /** Set for a socket opened with a session. */
  sessionId?: string;
  /** Session expiry in epoch milliseconds, as known when it was last read. */
  expiresAt?: number;
};

export type CredentialStatus = {
  valid: boolean;
  /** The session's current expiry (epoch ms), when it has one. */
  expiresAt?: number;
};

// Throws on a database error, which the caller treats as "unknown", not "revoked".
export async function readCredentialStatus(
  userId: string,
  credential: ConnectionCredential,
  now = Date.now(),
): Promise<CredentialStatus> {
  if (credential.apiKeyId) {
    const [key] = await db
      .select({
        enabled: apikeyTable.enabled,
        expiresAt: apikeyTable.expiresAt,
        referenceId: apikeyTable.referenceId,
        userId: apikeyTable.userId,
      })
      .from(apikeyTable)
      .where(eq(apikeyTable.id, credential.apiKeyId))
      .limit(1);
    const owned = key?.referenceId === userId || key?.userId === userId;
    return {
      valid:
        Boolean(key) &&
        owned &&
        key?.enabled !== false &&
        (!key?.expiresAt || key.expiresAt.getTime() > now),
    };
  }

  if (credential.sessionId) {
    const [session] = await db
      .select({
        expiresAt: sessionTable.expiresAt,
        userId: sessionTable.userId,
      })
      .from(sessionTable)
      .where(eq(sessionTable.id, credential.sessionId))
      .limit(1);
    if (!session || session.userId !== userId) return { valid: false };
    return {
      valid: session.expiresAt.getTime() > now,
      expiresAt: session.expiresAt.getTime(),
    };
  }

  return { valid: true };
}
