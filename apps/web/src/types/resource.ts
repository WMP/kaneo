export type ResourceKind = "person" | "equipment" | "material";

/** A task assignee's kind: a real Kaneo account ("user"), or one of the
 * account-less resource kinds. */
export type AssigneeKind = ResourceKind | "user";

/** The account a person resource is linked to, as the caller may see it. */
export type ResourceLinkedUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/** The invitation sent from a person resource, while it can still be accepted
 * ("pending") or is past its expiry ("expired"). */
export type ResourceInvitation = {
  status: "pending" | "expired";
  expiresAt: string;
};

/** A workspace-scoped assignable entity: a person, a piece of equipment, or a
 * material. Assignable to tasks like a user. A person resource has no account
 * until it is invited (the invitation link is remembered) or linked to a
 * member; then its assignments in the projects the account can open belong to
 * the account (see AssigneeAvatarItem for how it renders alongside real user
 * assignees). */
export type Resource = {
  id: string;
  workspaceId: string;
  kind: ResourceKind;
  name: string;
  email: string | null;
  // Linked to a Kaneo account, for every caller.
  linked: boolean;
  // The account's id and details, only for a caller who may see that member;
  // null for an unlinked resource, and for a linked one whose member the caller
  // cannot see (`linked` still says it is linked).
  userId: string | null;
  user?: ResourceLinkedUser | null;
  invitation?: ResourceInvitation | null;
  createdAt: string;
  updatedAt: string;
};

export default Resource;
