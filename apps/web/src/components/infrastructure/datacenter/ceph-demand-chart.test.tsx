import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CephDemandChart } from "./ceph-demand-chart";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key.replace("workspace:datacenter.storage.chart.", ""),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(cleanup);

const steps = [
  { date: "2026-09-01", usedCephGb: 10_000, usableGb: 20_000, percent: 50 },
  { date: "2026-11-01", usedCephGb: 25_000, usableGb: 20_000, percent: 125 },
  { date: "2027-01-01", usedCephGb: 30_000, usableGb: 40_000, percent: 75 },
];

function renderChart(
  overrides: Partial<Parameters<typeof CephDemandChart>[0]> = {},
) {
  return render(
    <CephDemandChart
      clusterName="Ceph GRA"
      region="GRA"
      steps={steps}
      usableAllGb={40_000}
      today="2026-10-16"
      {...overrides}
    />,
  );
}

describe("CephDemandChart", () => {
  it("renders a demand path and a capacity path", () => {
    renderChart();
    expect(screen.getByTestId("demand-line").getAttribute("d")).toMatch(/^M/);
    expect(screen.getByTestId("capacity-line").getAttribute("d")).toMatch(/^M/);
    expect(screen.getAllByTestId("demand-marker")).toHaveLength(3);
    expect(
      screen.getByRole("heading", { name: "Ceph GRA" }),
    ).toBeInTheDocument();
  });

  it("shows the dashed after-orders line only when it differs", () => {
    const { unmount } = renderChart({ usableAllGb: 60_000 });
    expect(
      screen.getByTestId("capacity-after-orders-line"),
    ).toBeInTheDocument();
    expect(screen.getByText("usableAfterOrders")).toBeInTheDocument();
    unmount();
    renderChart({ usableAllGb: 40_000 });
    expect(
      screen.queryByTestId("capacity-after-orders-line"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("usableAfterOrders")).not.toBeInTheDocument();
  });

  it("shades over-capacity intervals only when demand exceeds capacity", () => {
    const { unmount } = renderChart();
    expect(screen.getAllByTestId("over-capacity-region")).toHaveLength(1);
    expect(screen.getByText("overCapacity")).toBeInTheDocument();
    unmount();
    renderChart({
      steps: steps.map((s) => ({ ...s, usableGb: 100_000, percent: 10 })),
      usableAllGb: 100_000,
    });
    expect(
      screen.queryByTestId("over-capacity-region"),
    ).not.toBeInTheDocument();
  });

  it("shows the legend labels", () => {
    renderChart();
    expect(screen.getByText("demand")).toBeInTheDocument();
    expect(screen.getByText("usableDelivered")).toBeInTheDocument();
  });

  it("toggles a table with one row per step", () => {
    renderChart();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "showTable" }));
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(steps.length + 1);
    expect(within(rows[2]).getByText("25 TB")).toBeInTheDocument();
    expect(within(rows[2]).getByText("+15 TB")).toBeInTheDocument();
    expect(within(rows[2]).getByText("125%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "hideTable" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an empty state without demand", () => {
    renderChart({
      steps: [{ date: "2026-09-01", usedCephGb: 0, usableGb: 100, percent: 0 }],
    });
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.queryByTestId("demand-line")).not.toBeInTheDocument();
  });

  it("moves the tooltip with the arrow keys and hides it on Escape", () => {
    renderChart();
    const chart = screen.getByRole("application");
    expect(screen.queryByTestId("chart-tooltip")).not.toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByTestId("chart-tooltip")).toHaveTextContent(
      "Sep 1, 2026",
    );
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByTestId("chart-tooltip")).toHaveTextContent(
      "Nov 1, 2026",
    );
    expect(screen.getByTestId("chart-tooltip")).toHaveTextContent("+15 TB");
    expect(screen.getByTestId("crosshair")).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByTestId("chart-tooltip")).not.toBeInTheDocument();
  });
});
