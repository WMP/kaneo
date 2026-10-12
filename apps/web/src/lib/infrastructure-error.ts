import { readProjectApiError } from "@/lib/project-member-error";
import { readCode } from "@/lib/workspace-role-error";

// The infrastructure routes answer JSON `{ code, message }` for the failures a
// person can act on; the shared access middleware answers plain text. The UI
// branches on the code and never on English.
export const readInfrastructureError = readProjectApiError;

// Static keys keep the i18n checker able to see every string in use.
const ERROR_KEYS_BY_CODE: Record<string, string> = {
  INFRA_AVAILABLE_FROM_REQUIRED:
    "workspace:datacenter.errors.availableFromRequired",
  INFRA_CLUSTER_NAME_TAKEN: "workspace:datacenter.errors.clusterNameTaken",
  INFRA_CLUSTER_IN_USE: "workspace:datacenter.errors.clusterInUse",
  INFRA_CAPACITY_LOCKED: "workspace:datacenter.errors.capacityLocked",
  INFRA_CLUSTER_INVALID: "workspace:datacenter.errors.clusterInvalid",
  INFRA_REGION_IN_USE: "workspace:datacenter.errors.regionInUse",
};

type Translate = (key: string) => string;

/**
 * The translated text for a failed datacenter request: a known code gets its
 * own message, anything else `fallbackKey`. The API's English message is never
 * shown.
 */
export function getInfrastructureErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey: string,
): string {
  const code = readCode(error);
  const knownKey = code ? ERROR_KEYS_BY_CODE[code] : undefined;
  return t(knownKey ?? fallbackKey);
}
