import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderPlanTab } from "./order-plan-tab";
import type { OrderPlanRow } from "./types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const downloadOrderPlan = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/infrastructure/datacenter/download-order-plan", () => ({
  default: downloadOrderPlan,
}));

function row(overrides: Partial<OrderPlanRow>): OrderPlanRow {
  return {
    type: "host",
    orderByDate: "2026-11-02",
    needDate: "2027-01-04",
    provider: "ovh",
    region: "GRA",
    zone: null,
    model: "ADVANCE-2",
    family: null,
    ramGb: 256,
    vcpu: 32,
    storageGb: 960,
    quantity: 2,
    capacityGb: null,
    projectId: "p1",
    projectName: "Billing",
    clusterId: null,
    clusterName: null,
    labels: [],
    status: "planned",
    late: false,
    ...overrides,
  };
}

function renderTab(rows: OrderPlanRow[]) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <OrderPlanTab workspaceId="workspace-1" rows={rows} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  downloadOrderPlan.mockResolvedValue({
    blob: new Blob(["xlsx"]),
    filename: "order-plan-acme-2026-10-12.xlsx",
  });
  URL.createObjectURL = vi.fn(() => "blob:order-plan");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderPlanTab", () => {
  it("marks late rows with a badge and counts them in the summary", () => {
    renderTab([
      row({ late: true, orderByDate: "2026-09-01", model: "LATE-MODEL" }),
      row({ model: "ON-TIME" }),
      row({
        type: "storage_service",
        provider: null,
        model: null,
        ramGb: null,
        vcpu: null,
        storageGb: null,
        capacityGb: 2500,
        clusterName: "Ceph GRA",
        status: "suggested",
      }),
    ]);

    expect(
      screen.getByText("workspace:datacenter.orderPlan.rows 3"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workspace:datacenter.orderPlan.late 1"),
    ).toBeInTheDocument();

    const lateRow = screen.getByText("LATE-MODEL").closest("tr");
    expect(lateRow).toHaveAttribute("data-late", "true");
    expect(
      within(lateRow as HTMLElement).getByText(
        "workspace:datacenter.orderPlan.lateBadge",
      ),
    ).toBeInTheDocument();

    const onTimeRow = screen.getByText("ON-TIME").closest("tr");
    expect(onTimeRow).not.toHaveAttribute("data-late");
    expect(
      within(onTimeRow as HTMLElement).queryByText(
        "workspace:datacenter.orderPlan.lateBadge",
      ),
    ).not.toBeInTheDocument();

    expect(
      screen.getByText("workspace:datacenter.orderPlan.types.storageService"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ceph GRA")).toBeInTheDocument();
    expect(screen.getByText("2,500 GB")).toBeInTheDocument();
  });

  it("shows the zone after the region, with a dash for no zone", () => {
    renderTab([
      row({ model: "IN-ZONE", zone: "PAR2", region: "PAR" }),
      row({ model: "NO-ZONE" }),
    ]);
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers.indexOf("workspace:datacenter.fields.zone")).toBe(
      headers.indexOf("workspace:datacenter.fields.region") + 1,
    );
    const cells = (model: string) =>
      Array.from(
        (screen.getByText(model).closest("tr") as HTMLElement).querySelectorAll(
          "td",
        ),
      );
    const zoneIndex = headers.indexOf("workspace:datacenter.fields.zone");
    expect(cells("IN-ZONE")[zoneIndex].textContent).toBe("PAR2");
    expect(cells("NO-ZONE")[zoneIndex].textContent).toBe("–");
  });

  it("downloads the XLSX through the fetcher with the workspace id", async () => {
    renderTab([row({})]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "workspace:datacenter.orderPlan.download",
      }),
    );

    await waitFor(() => expect(downloadOrderPlan).toHaveBeenCalledOnce());
    expect(downloadOrderPlan).toHaveBeenCalledWith("workspace-1");
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it("shows an empty state when nothing is to be ordered", () => {
    renderTab([]);

    expect(
      screen.getByText("workspace:datacenter.orderPlan.empty"),
    ).toBeInTheDocument();
  });
});
