import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostsTab } from "./hosts-tab";
import { RegionsTab } from "./regions-tab";
import type { CatalogRegion, DatacenterHost } from "./types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const fetchers = vi.hoisted(() => ({
  createRegion: vi.fn(),
  updateRegion: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/datacenter/create-region", () => ({
  default: fetchers.createRegion,
}));
vi.mock("@/fetchers/infrastructure/datacenter/update-region", () => ({
  default: fetchers.updateRegion,
}));
vi.mock("@/fetchers/infrastructure/datacenter/delete-region", () => ({
  default: vi.fn(),
}));
// The real Select is a popup; a native select keeps the tests about behavior.
vi.mock("./dc-select", () => ({
  DcSelect: ({
    value,
    onChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const t = (key: string) => `workspace:datacenter.${key}`;

const region = (
  code: string,
  zones: string[],
  zoneUsage: Record<string, number>,
) =>
  ({
    id: `region-${code}`,
    code,
    name: `${code} name`,
    position: 0,
    zones,
    zoneUsage,
    usage: { models: 0, hosts: 0, clusters: 0 },
  }) as unknown as CatalogRegion;

function wrap(node: React.ReactNode) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RegionsTab zones", () => {
  it("shows the zones of a region with their host counts", () => {
    render(
      wrap(
        <RegionsTab
          workspaceId="workspace-1"
          regions={[
            region("PAR", ["PAR1", "PAR2"], { PAR1: 2 }),
            region("GRA", [], {}),
          ]}
          canManage={false}
        />,
      ),
    );

    expect(
      screen.getByText(`${t("regions.zoneHosts")} PAR1 2`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${t("regions.zoneHosts")} PAR2 0`),
    ).toBeInTheDocument();
  });

  it("adds normalized, unique zones in the create dialog and sends them", async () => {
    fetchers.createRegion.mockResolvedValue({});
    render(
      wrap(<RegionsTab workspaceId="workspace-1" regions={[]} canManage />),
    );
    fireEvent.click(screen.getByRole("button", { name: t("regions.add") }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(t("regions.code")), {
      target: { value: "par" },
    });
    fireEvent.change(within(dialog).getByLabelText(t("fields.name")), {
      target: { value: "Paris" },
    });
    const input = within(dialog).getByLabelText(t("regions.zoneInput"));
    const add = within(dialog).getByRole("button", {
      name: t("regions.addZone"),
    });
    expect(add).toBeDisabled();

    fireEvent.change(input, { target: { value: " par1 " } });
    fireEvent.click(add);
    expect(within(dialog).getByText("PAR1")).toBeInTheDocument();
    // Enter adds too, without submitting the form.
    fireEvent.change(input, { target: { value: "par2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(dialog).getByText("PAR2")).toBeInTheDocument();
    expect(fetchers.createRegion).not.toHaveBeenCalled();
    // A duplicate cannot be added.
    fireEvent.change(input, { target: { value: "Par1" } });
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: "" } });

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: `${t("regions.removeZone")} PAR1`,
      }),
    );
    expect(within(dialog).queryByText("PAR1")).not.toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: t("actions.save") }),
    );
    await waitFor(() => expect(fetchers.createRegion).toHaveBeenCalled());
    expect(fetchers.createRegion.mock.calls[0][0]).toEqual({
      workspaceId: "workspace-1",
      data: { code: "PAR", name: "Paris", zones: ["PAR2"] },
    });
  });

  it("blocks removing a zone that has hosts and sends the remaining zones", async () => {
    fetchers.updateRegion.mockResolvedValue({});
    render(
      wrap(
        <RegionsTab
          workspaceId="workspace-1"
          regions={[region("PAR", ["PAR1", "PAR2"], { PAR1: 2 })]}
          canManage
        />,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${t("regions.editAction")} PAR` }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByRole("button", {
        name: `${t("regions.removeZone")} PAR1`,
      }),
    ).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: `${t("regions.removeZone")} PAR2`,
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("actions.save") }),
    );

    await waitFor(() => expect(fetchers.updateRegion).toHaveBeenCalled());
    expect(fetchers.updateRegion.mock.calls[0][0]).toEqual({
      workspaceId: "workspace-1",
      regionId: "region-PAR",
      data: { name: "PAR name", zones: ["PAR1"] },
    });
  });
});

const host = (label: string, zone: string | null) =>
  ({
    id: label,
    projectId: "p1",
    projectName: "Billing",
    modelId: "m1",
    region: "PAR",
    zone,
    label,
    status: "planned",
    availableFrom: null,
    hostname: null,
    model: { name: "SCALE", ramGb: 256 },
    totals: { vmCount: 0 },
  }) as unknown as DatacenterHost;

describe("HostsTab zones", () => {
  const hosts = [host("H-1", "PAR1"), host("H-2", "PAR2"), host("H-3", null)];
  const renderTab = () =>
    render(
      wrap(
        <HostsTab
          workspaceId="workspace-1"
          hosts={hosts}
          capacity={undefined}
          canManage={false}
        />,
      ),
    );
  const zoneCell = (label: string) =>
    (screen.getByText(label).closest("tr") as HTMLElement).querySelectorAll(
      "td",
    )[4];

  it("shows a Zone column after Region, with a dash for no zone", () => {
    renderTab();
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers.indexOf(t("fields.zone"))).toBe(
      headers.indexOf(t("fields.region")) + 1,
    );
    expect(zoneCell("H-1").textContent).toBe("PAR1");
    expect(zoneCell("H-3").textContent).toBe("–");
  });

  it("filters the hosts by zone, offering the zones of the loaded hosts", () => {
    renderTab();
    const filter = screen.getByLabelText(t("fields.zone"));
    expect(
      within(filter)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([t("hosts.allZones"), "PAR1", "PAR2"]);

    fireEvent.change(filter, { target: { value: "PAR2" } });
    expect(screen.queryByText("H-1")).not.toBeInTheDocument();
    expect(screen.getByText("H-2")).toBeInTheDocument();
    expect(screen.queryByText("H-3")).not.toBeInTheDocument();
  });
});
