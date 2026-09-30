import RoleSelect from "@/components/team/role-select";
import { Label } from "@/components/ui/label";
import type { RoleChoice } from "@/hooks/use-role-choice";

type Props = {
  id: string;
  label: string;
  hint?: string;
  /** Names the caller may assign; undefined until loaded. */
  roles: string[] | undefined;
  isLoading: boolean;
  isError: boolean;
  choice: RoleChoice;
  texts: {
    loading: string;
    error: string;
    none: string;
    placeholder: string;
    pickRequired: string;
    unavailable: string;
  };
};

/** A labelled role picker with every loading, empty and stale state. */
function RoleField({
  id,
  label,
  hint,
  roles,
  isLoading,
  isError,
  choice,
  texts,
}: Props) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {!choice.hasData && isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {texts.loading}
        </p>
      ) : !choice.hasData && isError ? (
        <p className="text-sm text-destructive" role="alert">
          {texts.error}
        </p>
      ) : choice.isEmpty ? (
        <p className="text-sm text-muted-foreground" role="status">
          {texts.none}
        </p>
      ) : roles ? (
        <>
          <RoleSelect
            id={id}
            roles={roles}
            value={choice.unavailable ? choice.selected : choice.role}
            onChange={choice.select}
            placeholder={texts.placeholder}
          />
          {choice.unavailable ? (
            <p className="text-sm text-destructive" role="alert">
              {texts.unavailable}
            </p>
          ) : choice.needsExplicit ? (
            <p className="text-sm text-muted-foreground">
              {texts.pickRequired}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default RoleField;
