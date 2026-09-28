export type ResourceKind = "person" | "equipment" | "material";

/** A task assignee's kind: a real Kaneo account ("user"), or one of the
 * account-less resource kinds. */
export type AssigneeKind = ResourceKind | "user";

/** A workspace-scoped assignable entity with no Kaneo account: a person,
 * a piece of equipment, or a material. Assignable to tasks like a user,
 * but never able to sign in (see AssigneeAvatarItem for how it renders
 * alongside real user assignees). */
export type Resource = {
  id: string;
  workspaceId: string;
  kind: ResourceKind;
  name: string;
  email: string | null;
  // Linked Kaneo account, if any. Always null in this phase (F4a/F4a-web) —
  // set later by an email/OIDC invite flow (F4b).
  userId: string | null;
  createdAt: string;
  updatedAt: string;
};

export default Resource;
