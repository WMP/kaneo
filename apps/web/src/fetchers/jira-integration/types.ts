import type { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type Jira = (typeof client)["jira-integration"];

export type JiraConnection = NonNullable<
  InferResponseType<
    Jira["workspace"][":workspaceId"]["connection"]["$get"],
    200
  >
>;

export type PutJiraConnectionRequest = InferRequestType<
  Jira["workspace"][":workspaceId"]["connection"]["$put"]
>["json"];

export type JiraMappingLevel = InferResponseType<
  Jira["workspace"][":workspaceId"]["mapping"]["$get"],
  200
>;

export type JiraMappingConfig = JiraMappingLevel["config"];
export type ResolvedJiraMapping = JiraMappingLevel["parent"];
export type JiraMappingOrigin = ResolvedJiraMapping["jiraProjectKey"]["origin"];

export type JiraFieldMapping = NonNullable<
  JiraMappingConfig["fieldMappings"]
>[number];
export type JiraFieldType = JiraFieldMapping["target"]["type"];
export type JiraFieldSource = JiraFieldMapping["source"];
export type JiraStatusMapping = NonNullable<
  JiraMappingConfig["statusMappings"]
>[number];
export type JiraUserMapping = NonNullable<
  JiraMappingConfig["userMappings"]
>[number];
export type JiraLabelComponentMapping = NonNullable<
  JiraMappingConfig["labelComponentMappings"]
>[number];

export type JiraTokenStatus = InferResponseType<
  Jira["workspace"][":workspaceId"]["me"]["token"]["$get"],
  200
>;

export type PutJiraTokenRequest = InferRequestType<
  Jira["workspace"][":workspaceId"]["me"]["token"]["$put"]
>["json"];

export type JiraMetaProject = InferResponseType<
  Jira["workspace"][":workspaceId"]["meta"]["projects"]["$get"],
  200
>["projects"][number];

export type JiraMetaIssueType = InferResponseType<
  Jira["workspace"][":workspaceId"]["meta"]["issue-types"]["$get"],
  200
>["issueTypes"][number];

export type JiraMetaField = InferResponseType<
  Jira["workspace"][":workspaceId"]["meta"]["fields"]["$get"],
  200
>["fields"][number];

export type JiraMetaStatus = InferResponseType<
  Jira["workspace"][":workspaceId"]["meta"]["statuses"]["$get"],
  200
>["statuses"][number];

export type JiraMetaComponent = InferResponseType<
  Jira["workspace"][":workspaceId"]["meta"]["components"]["$get"],
  200
>["components"][number];

export type JiraMetaUser = InferResponseType<
  Jira["workspace"][":workspaceId"]["meta"]["users"]["$get"],
  200
>["users"][number];
