import { describe, expect, it } from "vitest";
import { getWorkspaceSettingsMenuItems } from "./workspace-settings-menu";

const t = (key: string, options?: Record<string, unknown>) =>
  (options?.defaultValue as string | undefined) ?? key;

describe("getWorkspaceSettingsMenuItems", () => {
  it("has a Members entry that leads to the members page of the workspace", () => {
    const items = getWorkspaceSettingsMenuItems({
      t,
      workspaceId: "ws-1",
      billingEnabled: false,
    });

    const members = items.find(
      (item) => item.title === "settings:workspaceMembers.title",
    );
    expect(members?.url).toBe("/dashboard/workspace/ws-1/members");
  });

  it("puts Members right after General, before Roles", () => {
    const titles = getWorkspaceSettingsMenuItems({
      t,
      workspaceId: "ws-1",
      billingEnabled: false,
    }).map((item) => item.title);

    expect(titles.slice(0, 3)).toEqual([
      "settings:workspaceGeneral.title",
      "settings:workspaceMembers.title",
      "Roles",
    ]);
  });

  it("leaves Members out until the workspace is known", () => {
    const urls = getWorkspaceSettingsMenuItems({
      t,
      workspaceId: undefined,
      billingEnabled: false,
    }).map((item) => item.url);

    expect(urls.some((url) => url.endsWith("/members"))).toBe(false);
    expect(urls).toContain("/dashboard/settings/workspace/roles");
  });

  it("adds Billing only when billing is enabled", () => {
    const without = getWorkspaceSettingsMenuItems({
      t,
      workspaceId: "ws-1",
      billingEnabled: false,
    });
    const withBilling = getWorkspaceSettingsMenuItems({
      t,
      workspaceId: "ws-1",
      billingEnabled: true,
    });

    expect(without.map((item) => item.url)).not.toContain(
      "/dashboard/settings/workspace/billing",
    );
    expect(withBilling.at(-1)?.url).toBe(
      "/dashboard/settings/workspace/billing",
    );
  });
});
