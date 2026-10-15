import {
  Bell,
  Building2,
  Code,
  CreditCard,
  Import,
  KeyRound,
  ListChecks,
  Plug,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Tag,
  Ticket,
  User,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import projectIcons from "@/constants/project-icons";
import type {
  SettingsNav,
  SettingsNavProject,
} from "@/components/settings/nav/types";

type Translate = (key: string) => string;

type BuildSettingsNavInput = {
  t: Translate;
  workspaceId?: string;
  workspaceName?: string;
  billingEnabled: boolean;
  canImport: boolean;
  hasAdminAccess: boolean;
  projects: { id: string; name: string; icon?: string | null }[];
};

const PROJECT_SECTIONS = [
  { id: "general", labelKey: "settings:projectGeneral.title" },
  { id: "members", labelKey: "projectMembers:title" },
  { id: "workflow", labelKey: "settings:projectWorkflow.title" },
  { id: "custom-fields", labelKey: "settings:projectCustomFields.title" },
  { id: "visibility", labelKey: "settings:projectVisibility.title" },
  { id: "integrations", labelKey: "settings:projectIntegrations.title" },
  { id: "calendar", labelKey: "settings:calendarFeeds.title" },
] as const;

function buildProject(
  t: Translate,
  project: BuildSettingsNavInput["projects"][number],
): SettingsNavProject {
  const icon =
    projectIcons[project.icon as keyof typeof projectIcons] ??
    projectIcons.Layout;

  return {
    id: project.id,
    name: project.name,
    icon,
    links: PROJECT_SECTIONS.map((section) => ({
      id: `project-${project.id}-${section.id}`,
      label: t(section.labelKey),
      to: `/dashboard/settings/projects/${project.id}/${section.id}`,
    })),
  };
}

export function buildSettingsNav({
  t,
  workspaceId,
  workspaceName,
  billingEnabled,
  canImport,
  hasAdminAccess,
  projects,
}: BuildSettingsNavInput): SettingsNav {
  return {
    account: {
      id: "account",
      label: t("settings:account"),
      links: [
        {
          id: "information",
          label: t("settings:information"),
          to: "/dashboard/settings/account/information",
          icon: User,
        },
        {
          id: "preferences",
          label: t("settings:preferences"),
          to: "/dashboard/settings/account/preferences",
          icon: SlidersHorizontal,
        },
        {
          id: "notifications",
          label: t("settings:notifications"),
          to: "/dashboard/settings/account/notifications",
          icon: Bell,
        },
        {
          id: "security",
          label: t("settings:security"),
          to: "/dashboard/settings/account/security",
          icon: KeyRound,
        },
        {
          id: "developer",
          label: t("settings:apiKeys"),
          to: "/dashboard/settings/account/developer",
          icon: Code,
        },
        {
          id: "mcp",
          label: t("settings:mcp"),
          to: "/dashboard/settings/account/mcp",
          icon: Plug,
        },
        {
          id: "account-jira",
          label: t("settings:jiraIntegration.menuTitle"),
          to: "/dashboard/settings/account/jira",
          icon: Ticket,
        },
      ],
    },
    workspace: {
      id: "workspace",
      label: workspaceName || t("navigation:page.settingsWorkspaceTab"),
      links: [
        {
          id: "workspace-general",
          label: t("settings:workspaceGeneral.title"),
          to: "/dashboard/settings/workspace/general",
          icon: Settings,
        },
        // The members page of the workspace lives outside the settings routes
        // (and stays in the main sidebar too); left out until the workspace is
        // known.
        ...(workspaceId
          ? [
              {
                id: "workspace-members",
                label: t("settings:workspaceMembers.title"),
                to: `/dashboard/workspace/${workspaceId}/members`,
                icon: Users,
              },
            ]
          : []),
        {
          id: "workspace-roles",
          label: t("settings:workspaceRoles.title"),
          to: "/dashboard/settings/workspace/roles",
          icon: Shield,
        },
        {
          id: "workspace-labels",
          label: t("settings:workspaceLabels.title"),
          to: "/dashboard/settings/workspace/labels",
          icon: Tag,
        },
        {
          id: "workspace-custom-fields",
          label: t("settings:workspaceCustomFields.title"),
          to: "/dashboard/settings/workspace/custom-fields",
          icon: ListChecks,
        },
        {
          id: "workspace-workflow",
          label: t("settings:workspaceWorkflow.title"),
          to: "/dashboard/settings/workspace/workflow",
          icon: Workflow,
        },
        {
          id: "workspace-resources",
          label: t("settings:workspaceResources.title"),
          to: "/dashboard/settings/workspace/resources",
          icon: Wrench,
        },
        {
          id: "workspace-jira",
          label: t("settings:jiraIntegration.menuTitle"),
          to: "/dashboard/settings/workspace/jira",
          icon: Ticket,
        },
        ...(canImport
          ? [
              {
                id: "workspace-import",
                label: t("settings:workspaceImport.title"),
                to: "/dashboard/settings/workspace/import",
                icon: Import,
              },
            ]
          : []),
        ...(billingEnabled
          ? [
              {
                id: "workspace-billing",
                label: t("settings:billing.pageTitle"),
                to: "/dashboard/settings/workspace/billing",
                icon: CreditCard,
              },
            ]
          : []),
      ],
    },
    projects: projects.map((project) => buildProject(t, project)),
    admin: hasAdminAccess
      ? {
          id: "admin",
          label: t("settings:administration"),
          links: [
            {
              id: "admin-users",
              label: t("settings:adminUsers.title"),
              to: "/dashboard/settings/admin/users",
              icon: Server,
            },
            {
              id: "admin-workspaces",
              label: t("settings:adminWorkspaces.title"),
              to: "/dashboard/settings/admin/workspaces",
              icon: Building2,
            },
          ],
        }
      : null,
  };
}
