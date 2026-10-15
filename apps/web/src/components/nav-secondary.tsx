import { useNavigate } from "@tanstack/react-router";
import { Settings, UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddPeopleDialog from "@/components/people/add-people-dialog";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export function NavSecondary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const { canInviteUsers, canAddMembers } = useWorkspacePermission();
  const canInvite = Boolean(canInviteUsers());
  const canAdd = Boolean(canAddMembers());
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  return (
    <>
      <SidebarMenu className="gap-0.5">
        {workspace?.id && (canInvite || canAdd) && (
          <SidebarMenuItem>
            <SidebarMenuButton
              size="default"
              className="h-8 text-sm"
              onClick={() => setIsInviteOpen(true)}
            >
              <UserPlus aria-hidden="true" />
              <span>{t("navigation:sidebar.invitePeople")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenuItem>
          <SidebarMenuButton
            size="default"
            className="h-8 text-sm"
            onClick={() =>
              navigate({ to: "/dashboard/settings/account/information" })
            }
          >
            <Settings aria-hidden="true" />
            <span>{t("navigation:userMenu.settings")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      {workspace?.id ? (
        <AddPeopleDialog
          open={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
          context={{ kind: "workspace", workspaceId: workspace.id }}
          canAdd={canAdd}
          canInvite={canInvite}
        />
      ) : null}
    </>
  );
}
