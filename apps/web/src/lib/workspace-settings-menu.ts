import {
  CreditCard,
  ListChecks,
  type LucideIcon,
  Settings,
  Shield,
  Tag,
  Users,
  Wrench,
} from "lucide-react";

export type WorkspaceSettingsMenuItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The entries of Settings → Workspace. "Members" leads to the members page of
 * the workspace (which lives outside the settings routes, and stays in the main
 * sidebar as well); it is left out until the workspace is known.
 */
export function getWorkspaceSettingsMenuItems({
  t,
  workspaceId,
  billingEnabled,
}: {
  t: Translate;
  workspaceId: string | undefined;
  billingEnabled: boolean;
}): WorkspaceSettingsMenuItem[] {
  return [
    {
      title: t("settings:workspaceGeneral.title"),
      url: "/dashboard/settings/workspace/general",
      icon: Settings,
    },
    ...(workspaceId
      ? [
          {
            title: t("settings:workspaceMembers.title"),
            url: `/dashboard/workspace/${workspaceId}/members`,
            icon: Users,
          },
        ]
      : []),
    {
      title: t("settings:workspaceRoles.title", { defaultValue: "Roles" }),
      url: "/dashboard/settings/workspace/roles",
      icon: Shield,
    },
    {
      title: t("settings:workspaceLabels.title", { defaultValue: "Labels" }),
      url: "/dashboard/settings/workspace/labels",
      icon: Tag,
    },
    {
      title: t("settings:workspaceCustomFields.title", {
        defaultValue: "Custom Fields",
      }),
      url: "/dashboard/settings/workspace/custom-fields",
      icon: ListChecks,
    },
    {
      title: t("settings:workspaceResources.title", {
        defaultValue: "Resources",
      }),
      url: "/dashboard/settings/workspace/resources",
      icon: Wrench,
    },
    ...(billingEnabled
      ? [
          {
            title: "Billing",
            url: "/dashboard/settings/workspace/billing",
            icon: CreditCard,
          },
        ]
      : []),
  ];
}
