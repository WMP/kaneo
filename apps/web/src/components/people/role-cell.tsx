import { ShieldIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import RoleSelect from "@/components/team/role-select";
import { Badge } from "@/components/ui/badge";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";

type Props = {
  /** The role to show. */
  role: string;
  /**
   * The roles the caller may choose from. The row's own role is added when it
   * is not among them, so it can be displayed as the selected value.
   */
  assignable: string[];
  /** The caller may change this person's role (the API decides again). */
  canChange: boolean;
  onChange: (role: string) => void;
  ariaLabel: string;
  /**
   * Keep the row's own role among the options when the caller could not assign
   * it (default). A role that grants nothing any more should not be offered.
   */
  offerCurrentRole?: boolean;
};

/**
 * A person's role: a picker limited to the roles the caller may assign, or a
 * badge when they may not change it (or the role is `owner`, which nobody
 * assigns).
 */
function RoleCell({
  role,
  assignable,
  canChange,
  onChange,
  ariaLabel,
  offerCurrentRole = true,
}: Props) {
  const { t } = useTranslation();

  if (role === "owner") {
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldIcon className="size-3" />
        {t("team:roles.owner")}
      </Badge>
    );
  }

  if (canChange) {
    const options =
      assignable.includes(role) || !offerCurrentRole
        ? assignable
        : [role, ...assignable];
    return (
      <RoleSelect
        roles={options}
        value={role}
        onChange={onChange}
        size="sm"
        className="h-8 w-32"
        ariaLabel={ariaLabel}
      />
    );
  }

  return <Badge variant="secondary">{getWorkspaceRoleLabel(role, t)}</Badge>;
}

export default RoleCell;
