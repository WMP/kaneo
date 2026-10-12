import type { TFunction } from "i18next";
import { readProjectApiError } from "@/lib/project-member-error";
import { readCode } from "@/lib/workspace-role-error";

// The infrastructure routes answer JSON `{ code, message }` for the failures a
// person can act on (apps/api/src/infrastructure/errors.ts); the shared access
// middleware answers plain text. The UI branches on the code, never on English.
export const readInfrastructureError = readProjectApiError;

// Static keys keep the i18n checker able to see every string in use. One code
// can mean different things on the two surfaces (INFRA_REGION_IN_USE: a model
// region a host uses, or the region of a Ceph cluster VMs use), so each
// surface has its own map.
const PROJECT_ERROR_KEYS: Record<string, string> = {
  INFRA_REGION_NOT_ALLOWED:
    "settings:projectInfrastructure.errors.regionNotAllowed",
  INFRA_MODEL_IN_USE: "settings:projectInfrastructure.errors.modelInUse",
  INFRA_REGION_IN_USE: "settings:projectInfrastructure.errors.regionInUse",
  INFRA_HOST_LOCKED: "settings:projectInfrastructure.errors.hostLocked",
  INFRA_HOST_NOT_IN_PROJECT:
    "settings:projectInfrastructure.errors.hostNotInProject",
  INFRA_CLUSTER_REGION_MISMATCH:
    "settings:projectInfrastructure.errors.clusterRegionMismatch",
  INFRA_CLUSTER_NOT_IN_WORKSPACE:
    "settings:projectInfrastructure.errors.clusterNotInWorkspace",
  INFRA_VM_NOT_IN_TASK: "settings:projectInfrastructure.errors.vmNotInTask",
};

const DATACENTER_ERROR_KEYS: Record<string, string> = {
  INFRA_AVAILABLE_FROM_REQUIRED:
    "workspace:datacenter.errors.availableFromRequired",
  INFRA_CLUSTER_NAME_TAKEN: "workspace:datacenter.errors.clusterNameTaken",
  INFRA_CLUSTER_IN_USE: "workspace:datacenter.errors.clusterInUse",
  INFRA_CAPACITY_LOCKED: "workspace:datacenter.errors.capacityLocked",
  INFRA_CLUSTER_INVALID: "workspace:datacenter.errors.clusterInvalid",
  INFRA_REGION_IN_USE: "workspace:datacenter.errors.regionInUse",
};

/** A translated message for a failed project infrastructure request. */
export function getInfrastructureErrorMessage(
  error: unknown,
  t: TFunction,
): string {
  const code = readCode(error);
  const key = code ? PROJECT_ERROR_KEYS[code] : undefined;
  return key ? t(key) : t("common:error.messages.unknown");
}

type Translate = (key: string) => string;

/**
 * The translated text for a failed datacenter request: a known code gets its
 * own message, anything else `fallbackKey`.
 */
export function getDatacenterErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey: string,
): string {
  const code = readCode(error);
  const key = code ? DATACENTER_ERROR_KEYS[code] : undefined;
  return t(key ?? fallbackKey);
}
