import { useState } from "react";

// Preferred role for a new member or invitation. The API decides which roles
// the caller may grant, so this only applies when it is in that list.
export const PREFERRED_ROLE = "member";

export type RoleChoice = {
  /** The role that will be sent; undefined until one is valid. */
  role: string | undefined;
  /** The raw pick, even when it vanished from a refetched list. */
  selected: string | null;
  select: (role: string | null) => void;
  hasData: boolean;
  /** The pick is no longer in the assignable list: choose again. */
  unavailable: boolean;
  /** Roles exist, none is chosen and none is a safe default. */
  needsExplicit: boolean;
  /** The list loaded and is empty: nothing can be assigned. */
  isEmpty: boolean;
};

/**
 * The role a dialog will send, chosen from the roles the caller may assign.
 * Only `member` is ever picked for the user, and only while it is assignable:
 * a silent fallback to the first listed role could hand out an admin role.
 * A pick that vanished from a refetch is not replaced; the user chooses again.
 */
export function useRoleChoice(
  roles: string[] | undefined,
  preferred: string = PREFERRED_ROLE,
): RoleChoice {
  const [selected, select] = useState<string | null>(null);
  const hasData = roles !== undefined;
  const isAssignable = (candidate: string) => roles?.includes(candidate);
  const defaultRole = isAssignable(preferred) ? preferred : undefined;
  const unavailable = hasData && selected !== null && !isAssignable(selected);
  const role = !hasData || unavailable ? undefined : (selected ?? defaultRole);
  const isEmpty = hasData && roles.length === 0;
  return {
    role,
    selected,
    select,
    hasData,
    unavailable,
    needsExplicit: hasData && !isEmpty && !role && !unavailable,
    isEmpty,
  };
}
