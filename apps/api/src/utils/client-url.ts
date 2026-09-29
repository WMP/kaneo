// The URL the web app is served from: the base of every link Kaneo puts in an
// email and the origin Better Auth trusts. Read at call time so it follows the
// environment (`dotenv` is loaded by `auth.ts` after its imports).
export function getClientUrl(): string {
  return process.env.KANEO_CLIENT_URL || "http://localhost:5173";
}
