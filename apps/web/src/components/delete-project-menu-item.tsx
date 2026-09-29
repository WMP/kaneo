import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/menu";
import { useProjectPermission } from "@/hooks/use-project-permission";

// Deleting a project is decided per project (the project role for a member),
// so the menu item asks for its own project. It only mounts, and so only asks,
// while the row's menu is open; the row prefetches the answer when the pointer
// or focus reaches its menu button, so it is normally there when the menu
// opens. If it is not, the item is shown disabled instead of popping in.
export function DeleteProjectMenuItem({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const { canDeleteProject, isCheckingPermissions } =
    useProjectPermission(projectId);
  if (!isCheckingPermissions && !canDeleteProject()) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="h-7 items-start text-destructive cursor-pointer text-sm"
        disabled={isCheckingPermissions}
        onClick={onSelect}
      >
        <Trash2 className="text-destructive" />
        <span>{t("navigation:projectList.deleteProject")}</span>
      </DropdownMenuItem>
    </>
  );
}
