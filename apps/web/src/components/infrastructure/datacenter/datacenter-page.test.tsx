import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatacenterPage } from "./datacenter-page";
import { HostsTab } from "./hosts-tab";
import { RegionsTab } from "./regions-tab";
import { StorageTab } from "./storage-tab";
import type { CatalogRegion, DatacenterHost, StorageCluster } from "./types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const permission = vi.hoisted(() => ({
  read: false,
  manage: false,
  checking: false,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadDatacenter: () => permission.read,
    canManageDatacenter: () => permission.manage,
    isCheckingPermissions: permission.checking,
  }),
}));

const queries = vi.hoisted(() => ({
  capacity: vi.fn(),
  hosts: vi.fn(),
  clusters: vi.fn(),
  regions: vi.fn(),
}));
vi.mock(
  "@/hooks/queries/infrastructure/datacenter/use-workspace-capacity",
  () => ({ default: queries.capacity }),
);
vi.mock(
  "@/hooks/queries/infrastructure/datacenter/use-workspace-hosts",
  () => ({ default: queries.hosts }),
);
vi.mock(
  "@/hooks/queries/infrastructure/datacenter/use-storage-clusters",
  () => ({ default: queries.clusters }),
);

vi.mock("@/hooks/queries/infrastructure/datacenter/use-regions", () => ({
  default: queries.regions,
}));

const pending = { data: undefined, isError: false };

const host = {
  id: "host-1",
  projectId: "p1",
  projectName: "Billing",
  modelId: "m1",
  region: "GRA",
  label: "ADVANCE-2 256 GB GRA #1",
  status: "planned",
  availableFrom: null,
  hostname: null,
  model: { name: "ADVANCE-2", ramGb: 256 },
  totals: { vmCount: 3 },
} as unknown as DatacenterHost;

const cluster = {
  id: "cluster-1",
  name: "Ceph GRA",
  region: "GRA",
  kind: "self_managed",
  ecDataChunks: 4,
  ecCodingChunks: 2,
  fillThresholdPercent: 80,
  capacity: [
    {
      id: "entry-1",
      label: "Ceph GRA #1",
      modelName: "STOR-2",
      capacityGb: 24000,
      status: "planned",
      availableFrom: null,
      hostname: null,
    },
    {
      id: "entry-2",
      label: "Ceph GRA #2",
      modelName: "STOR-2",
      capacityGb: 24000,
      status: "installed",
      availableFrom: "2026-01-05",
      hostname: "stor-2",
    },
  ],
  totals: { rawCapacityGb: 24000, usedCephGb: 1200 },
} as unknown as StorageCluster;

function wrap(node: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}

beforeEach(() => {
  permission.read = false;
  permission.manage = false;
  permission.checking = false;
  queries.capacity.mockReturnValue(pending);
  queries.hosts.mockReturnValue(pending);
  queries.clusters.mockReturnValue(pending);
  queries.regions.mockReturnValue(pending);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DatacenterPage", () => {
  it("shows an empty state and sends no datacenter request without datacenter read", () => {
    render(wrap(<DatacenterPage workspaceId="workspace-1" />));

    expect(
      screen.getByText("workspace:datacenter.noAccess.title"),
    ).toBeInTheDocument();
    // `undefined` is what turns every query into skipToken.
    expect(queries.capacity).toHaveBeenCalledWith(undefined);
    expect(queries.hosts).toHaveBeenCalledWith(undefined);
    expect(queries.clusters).toHaveBeenCalledWith(undefined);
    expect(queries.regions).toHaveBeenCalledWith(undefined);
  });

  it("requests the workspace data with datacenter read", () => {
    permission.read = true;
    render(wrap(<DatacenterPage workspaceId="workspace-1" />));

    expect(queries.capacity).toHaveBeenCalledWith("workspace-1");
    expect(queries.hosts).toHaveBeenCalledWith("workspace-1");
    expect(queries.clusters).toHaveBeenCalledWith("workspace-1");
    expect(queries.regions).toHaveBeenCalledWith("workspace-1");
    expect(
      screen.queryByText("workspace:datacenter.noAccess.title"),
    ).not.toBeInTheDocument();
  });
});

describe("HostsTab", () => {
  it("hides the change status action without datacenter manage", () => {
    render(
      wrap(
        <HostsTab
          workspaceId="workspace-1"
          hosts={[host]}
          capacity={undefined}
          canManage={false}
        />,
      ),
    );

    expect(screen.getByText("ADVANCE-2 256 GB GRA #1")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "workspace:datacenter.actions.changeStatus",
      }),
    ).not.toBeInTheDocument();
  });

  it("offers the change status action with datacenter manage", () => {
    render(
      wrap(
        <HostsTab
          workspaceId="workspace-1"
          hosts={[host]}
          capacity={undefined}
          canManage
        />,
      ),
    );

    expect(
      screen.getByRole("button", {
        name: "workspace:datacenter.actions.changeStatus",
      }),
    ).toBeInTheDocument();
  });
});

describe("StorageTab", () => {
  it("hides every manage control without datacenter manage", () => {
    render(
      wrap(
        <StorageTab
          workspaceId="workspace-1"
          clusters={[cluster]}
          results={[]}
          regions={[]}
          canManage={false}
        />,
      ),
    );

    expect(screen.getByText("Ceph GRA")).toBeInTheDocument();
    expect(screen.getByText("Ceph GRA #1")).toBeInTheDocument();
    for (const name of [
      "workspace:datacenter.storage.addCluster",
      "workspace:datacenter.storage.addEntry",
      "workspace:datacenter.storage.editCluster",
      "workspace:datacenter.actions.changeStatus",
      "common:actions.delete",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("offers cluster and entry actions with datacenter manage, deleting only planned entries", () => {
    render(
      wrap(
        <StorageTab
          workspaceId="workspace-1"
          clusters={[cluster]}
          results={[]}
          regions={[]}
          canManage
        />,
      ),
    );

    expect(
      screen.getByRole("button", {
        name: "workspace:datacenter.storage.addCluster",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "workspace:datacenter.storage.addEntry",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "workspace:datacenter.actions.changeStatus",
      }),
    ).toHaveLength(2);
    // The cluster delete plus the one planned entry; the installed entry has none.
    expect(
      screen.getAllByRole("button", { name: "common:actions.delete" }),
    ).toHaveLength(2);
  });
});

const region = (
  code: string,
  usage: { models: number; hosts: number; clusters: number },
) =>
  ({
    id: `region-${code}`,
    code,
    name: `${code} name`,
    position: 0,
    zones: [],
    zoneUsage: {},
    usage,
  }) as unknown as CatalogRegion;

describe("RegionsTab", () => {
  const regions = [
    region("GRA", { models: 2, hosts: 3, clusters: 1 }),
    region("PAR", { models: 0, hosts: 0, clusters: 0 }),
  ];

  it("is read-only without datacenter manage", () => {
    render(
      wrap(
        <RegionsTab
          workspaceId="workspace-1"
          regions={regions}
          canManage={false}
        />,
      ),
    );

    expect(screen.getByText("GRA")).toBeInTheDocument();
    expect(screen.getByText("PAR name")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "workspace:datacenter.regions.add",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /workspace:datacenter\.regions\.(edit|delete)Action/,
      }),
    ).not.toBeInTheDocument();
  });

  it("lets a manager edit every region but delete only an unused one", () => {
    render(
      wrap(
        <RegionsTab workspaceId="workspace-1" regions={regions} canManage />,
      ),
    );

    expect(
      screen.getByRole("button", { name: "workspace:datacenter.regions.add" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: /workspace:datacenter\.regions\.editAction/,
      }),
    ).toHaveLength(2);
    // The mocked `t` ignores interpolation: one delete button per row, in order.
    const [usedDelete, unusedDelete] = screen.getAllByRole("button", {
      name: "workspace:datacenter.regions.deleteAction",
    });
    expect(usedDelete).toBeDisabled();
    expect(unusedDelete).toBeEnabled();
  });

  it("shows an empty state", () => {
    render(
      wrap(<RegionsTab workspaceId="workspace-1" regions={[]} canManage />),
    );
    expect(
      screen.getByText("workspace:datacenter.regions.empty"),
    ).toBeInTheDocument();
  });
});
