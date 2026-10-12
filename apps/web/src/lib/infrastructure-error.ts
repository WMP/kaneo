import type { TFunction } from "i18next";
import { readCode } from "@/lib/workspace-role-error";

// Static keys keep the i18n checker able to see every string in use. The codes
// are the `code` of the JSON errors of apps/api/src/infrastructure/errors.ts.
const ERROR_KEYS_BY_CODE: Record<string, string> = {
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

/** A translated message for a failed infrastructure request. */
export function getInfrastructureErrorMessage(
  error: unknown,
  t: TFunction,
): string {
  const code = readCode(error);
  const key = code ? ERROR_KEYS_BY_CODE[code] : undefined;
  return key ? t(key) : t("common:error.messages.unknown");
}
