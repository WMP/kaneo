import { isCloud } from "./is-cloud";

// Is the searchable directory of all accounts of the instance available?
//
// The directory lets somebody who may add workspace members find an existing
// account by name or email, which reveals that an account exists. That suits a
// company instance where everybody knows everybody, and not a public instance
// with strangers, so:
//
// - `DISABLE_USER_DIRECTORY=true` turns it off everywhere (and wins over the
//   flag below);
// - on Kaneo Cloud (`KANEO_CLOUD=true`) it is off unless
//   `ENABLE_USER_DIRECTORY=true`;
// - otherwise (a self-hosted instance) it is on.
//
// Read on every call, not at import, so tests and operators' restarts see the
// current environment.
export function isUserDirectoryEnabled(): boolean {
  if (process.env.DISABLE_USER_DIRECTORY === "true") return false;
  if (isCloud()) return process.env.ENABLE_USER_DIRECTORY === "true";
  return true;
}
