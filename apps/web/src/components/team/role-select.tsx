import { useTranslation } from "react-i18next";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type Props = {
  id?: string;
  /** Roles the user may choose from. */
  roles: string[];
  /**
   * The role to display. It need not be one of `roles`: a member's current role
   * or a vanished pick is shown, but can never be chosen.
   */
  value: string | null | undefined;
  onChange: (role: string) => void;
  placeholder?: string;
  size?: "default" | "sm";
  className?: string;
  ariaLabel?: string;
};

/**
 * Workspace role picker shared by the invite modal and the members table.
 *
 * Two Base UI behaviours are handled here once:
 * - A mounted Select resets its value on its own (reported as an ordinary
 *   change) when items leave the list, which would silently pick a role. It is
 *   therefore keyed by the option set: a fresh instance never resets.
 * - Change events are accepted whatever their reason (typeahead on the closed
 *   trigger reports "none" too), but only for a role that is in `roles`.
 */
function RoleSelect({
  id,
  roles,
  value,
  onChange,
  placeholder,
  size,
  className,
  ariaLabel,
}: Props) {
  const { t } = useTranslation();
  const displayedLabel = value ? getWorkspaceRoleLabel(value, t) : null;

  return (
    <Select
      key={roles.join("|")}
      id={id}
      value={value ?? null}
      onValueChange={(next) => {
        if (typeof next === "string" && roles.includes(next)) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger size={size} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder}>{displayedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {getWorkspaceRoleLabel(role, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default RoleSelect;
