import { codedError } from "../utils/coded-error";

// Errors of the resource invitation and link routes: JSON `{ code, message }`
// like the project invitation routes, so the web client can branch on `code`.
export const RESOURCE_ERROR_CODES = {
  notPerson: "RESOURCE_NOT_PERSON",
  noEmail: "RESOURCE_HAS_NO_EMAIL",
  alreadyLinked: "RESOURCE_ALREADY_LINKED",
  notLinked: "RESOURCE_NOT_LINKED",
  notMember: "NOT_A_WORKSPACE_MEMBER",
  changed: "RESOURCE_CHANGED",
  duplicateProject: "DUPLICATE_PROJECT",
  emailNotAllowed: "RESOURCE_EMAIL_NOT_ALLOWED",
  nameRequired: "RESOURCE_NAME_REQUIRED",
  notFound: "RESOURCE_NOT_FOUND",
  workspaceNotFound: "WORKSPACE_NOT_FOUND",
} as const;

export const resourceError = codedError;
