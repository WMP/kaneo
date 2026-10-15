import { describe, expect, it } from "vite-plus/test";
import { buildSettingsNav } from "@/components/settings/nav/build-settings-nav";

const t = (key: string) => key;

function build(
  overrides: Partial<Parameters<typeof buildSettingsNav>[0]> = {},
) {
  return buildSettingsNav({
    t,
    workspaceName: "Acme",
    billingEnabled: false,
    canImport: false,
    hasAdminAccess: false,
    projects: [],
    ...overrides,
  });
}

describe("buildSettingsNav", () => {
  it("labels the workspace group with the workspace name", () => {
    expect(build().workspace.label).toBe("Acme");
    expect(build({ workspaceName: undefined }).workspace.label).toBe(
      "navigation:page.settingsWorkspaceTab",
    );
  });

  it("only offers billing when billing is enabled", () => {
    const linkIds = (nav: ReturnType<typeof build>) =>
      nav.workspace.links.map((link) => link.id);

    expect(linkIds(build())).not.toContain("workspace-billing");
    expect(linkIds(build({ billingEnabled: true }))).toContain(
      "workspace-billing",
    );
  });

  it("only offers import to people who can import", () => {
    const links = (nav: ReturnType<typeof build>) =>
      nav.workspace.links.map((link) => link.to);

    expect(links(build())).not.toContain(
      "/dashboard/settings/workspace/import",
    );
    expect(links(build({ canImport: true, billingEnabled: true }))).toEqual([
      "/dashboard/settings/workspace/general",
      "/dashboard/settings/workspace/roles",
      "/dashboard/settings/workspace/labels",
      "/dashboard/settings/workspace/custom-fields",
      "/dashboard/settings/workspace/workflow",
      "/dashboard/settings/workspace/resources",
      "/dashboard/settings/workspace/jira",
      "/dashboard/settings/workspace/import",
      "/dashboard/settings/workspace/billing",
    ]);
  });

  it("leads the Members entry to the members page, right after General", () => {
    const links = build({ workspaceId: "ws-1" }).workspace.links;

    expect(links.slice(0, 3).map((link) => link.to)).toEqual([
      "/dashboard/settings/workspace/general",
      "/dashboard/workspace/ws-1/members",
      "/dashboard/settings/workspace/roles",
    ]);
  });

  it("offers the fork's workspace and account pages", () => {
    const nav = build({ workspaceId: "ws-1" });

    expect(nav.account.links.map((link) => link.to)).toEqual(
      expect.arrayContaining([
        "/dashboard/settings/account/mcp",
        "/dashboard/settings/account/jira",
      ]),
    );
    const workspace = nav.workspace.links.map((link) => link.to);
    expect(workspace.indexOf("/dashboard/settings/workspace/workflow")).toBe(
      workspace.indexOf("/dashboard/settings/workspace/custom-fields") + 1,
    );
  });

  it("only shows administration to instance admins", () => {
    expect(build().admin).toBeNull();
    expect(
      build({ hasAdminAccess: true }).admin?.links.map((link) => link.to),
    ).toEqual([
      "/dashboard/settings/admin/users",
      "/dashboard/settings/admin/workspaces",
    ]);
  });

  it("gives every project its own settings pages", () => {
    const nav = build({
      projects: [{ id: "p1", name: "Kaneo Web", icon: "Unknown" }],
    });

    expect(nav.projects).toHaveLength(1);
    expect(nav.projects[0]?.links.map((link) => link.to)).toEqual([
      "/dashboard/settings/projects/p1/general",
      "/dashboard/settings/projects/p1/members",
      "/dashboard/settings/projects/p1/workflow",
      "/dashboard/settings/projects/p1/custom-fields",
      "/dashboard/settings/projects/p1/visibility",
      "/dashboard/settings/projects/p1/integrations",
      "/dashboard/settings/projects/p1/calendar",
    ]);
    expect(nav.projects[0]?.links[3]?.label).toBe(
      "settings:projectCustomFields.title",
    );
    expect(nav.projects[0]?.icon).toBeDefined();
  });
});
