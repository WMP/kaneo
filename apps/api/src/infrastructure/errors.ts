import type { HTTPException } from "hono/http-exception";
import { codedError } from "../utils/coded-error";

// JSON `{ code, message }` errors of the infrastructure API, so a client
// branches on the code instead of on English text.
export const INFRA_ERROR_CODES = {
  regionNotAllowed: "INFRA_REGION_NOT_ALLOWED",
  regionInUse: "INFRA_REGION_IN_USE",
  modelInUse: "INFRA_MODEL_IN_USE",
  hostLocked: "INFRA_HOST_LOCKED",
  hostNotInProject: "INFRA_HOST_NOT_IN_PROJECT",
  vmNotInTask: "INFRA_VM_NOT_IN_TASK",
  availableFromRequired: "INFRA_AVAILABLE_FROM_REQUIRED",
} as const;

export function infraError(
  status: 400 | 404 | 409,
  code: string,
  message: string,
): HTTPException {
  return codedError(status, code, message);
}
