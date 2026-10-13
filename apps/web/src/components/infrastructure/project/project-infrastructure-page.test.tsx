import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createProjectHost from "@/fetchers/infrastructure/create-project-host";
import createProjectModel from "@/fetchers/infrastructure/create-project-model";
import deleteProjectHost from "@/fetchers/infrastructure/delete-project-host";
import deleteProjectModel from "@/fetchers/infrastructure/delete-project-model";
import getProjectCapacity from "@/fetchers/infrastructure/get-project-capacity";
import getProjectHosts from "@/fetchers/infrastructure/get-project-hosts";
import getProjectModels from "@/fetchers/infrastructure/get-project-models";
import getProjectRegions from "@/fetchers/infrastructure/get-project-regions";
import { toast } from "@/lib/toast";
import { ProjectInfrastructurePage } from "./project-infrastructure-page";

vi.mock("@/fetchers/infrastructure/get-project-models", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/get-project-hosts", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/get-project-capacity", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/get-project-regions", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/create-project-model", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/create-project-host", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/delete-project-model", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/delete-project-host", () => ({
  default: vi.fn(),
}));

const permissions = {
  read: true,
  plan: true,
  manage: true,
};
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({
    canReadInfrastructure: () => permissions.read,
    canPlanInfrastructure: () => permissions.plan,
    canManageInfrastructure: () => permissions.manage,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/task">{children}</a>
  ),
}));
vi.mock("../infra-select", () => ({
  InfraSelect: ({
    value,
    onChange,
    options,
    ariaLabel,
  }: {
    value: string | null;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const model = {
  id: "model-1",
  projectId: "project-1",
  name: "SCALE-256",
  provider: "ovh" as const,
  family: "SCALE",
  ramGb: 256,
  vcpu: 64,
  storageGb: 2000,
  regions: ["GRA", "PAR"],
  leadTimeDays: 21,
  hypervisorReservePercent: 5,
  position: 0,
};

const baseHost = {
  projectId: "project-1",
  modelId: "model-1",
  hostname: null,
  model,
  totals: { vmCount: 3, vcpu: 24, ramGb: 180, localStorageGb: 300 },
};
const plannedHost = {
  ...baseHost,
  id: "host-planned",
  label: "SCALE-1",
  region: "PAR",
  status: "planned" as const,
  availableFrom: null,
};
const installedHost = {
  ...baseHost,
  id: "host-installed",
  label: "SCALE-2",
  region: "GRA",
  status: "installed" as const,
  availableFrom: "2026-09-01",
};

const capacity = {
  today: "2026-10-12",
  hosts: [
    {
      host: plannedHost,
      result: {
        hostId: "host-planned",
        needDate: "2026-10-20",
        orderByDate: "2026-09-29",
        peakRamPercent: 58.4,
      },
    },
    {
      host: installedHost,
      result: {
        hostId: "host-installed",
        needDate: "2026-09-10",
        orderByDate: "2026-08-20",
        peakRamPercent: 104,
      },
    },
  ],
  warnings: [
    {
      type: "ORDER_LATE",
      severity: "error",
      hostId: "host-planned",
      date: "2026-09-29",
    },
    {
      type: "VM_UNPLACED",
      severity: "warning",
      vmId: "vm-1",
      vmName: "billing-db-1",
      taskId: "task-1",
      taskTitle: "Migrate billing",
    },
  ],
  unplacedVms: [],
  unscheduledVms: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions.read = true;
  permissions.plan = true;
  permissions.manage = true;
  vi.mocked(getProjectModels).mockResolvedValue([model] as never);
  vi.mocked(getProjectHosts).mockResolvedValue([
    plannedHost,
    installedHost,
  ] as never);
  vi.mocked(getProjectCapacity).mockResolvedValue(capacity as never);
  vi.mocked(getProjectRegions).mockResolvedValue([
    { code: "GRA", name: "Gravelines" },
    { code: "PAR", name: "Paris" },
  ]);
});
afterEach(cleanup);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ProjectInfrastructurePage projectId="project-1" workspaceId="ws-1" />
    </QueryClientProvider>,
  );
  return invalidate;
}

describe("project infrastructure settings", () => {
  it("shows the pool, the hosts and the peak RAM percent", async () => {
    renderPage();

    expect(await screen.findByText("SCALE-256")).toBeInTheDocument();
    expect(screen.getAllByText("PAR").length).toBeGreaterThan(0);
    expect(await screen.findByText("58%")).toBeInTheDocument();
    // Over 100 percent shows the real value; the bar itself is capped.
    expect(screen.getByText("104%")).toBeInTheDocument();
    expect(screen.getAllByRole("meter")).toHaveLength(2);
    expect(screen.getAllByText("300 / 2000", { exact: false })).toHaveLength(2);
  });

  it("marks a late order date of a planned host", async () => {
    renderPage();
    await screen.findByText("58%");
    const late = document.querySelectorAll("[data-late]");
    expect(late).toHaveLength(1);
    expect(late[0]).toHaveTextContent("Sep 29, 2026");
  });

  it("lists the warnings with a link to the task", async () => {
    renderPage();
    expect(
      await screen.findByText(/types\.orderLate SCALE-1 Sep 29, 2026/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Migrate billing" }),
    ).toBeInTheDocument();
  });

  it("hides every editing control without the permissions", async () => {
    permissions.plan = false;
    permissions.manage = false;
    renderPage();
    await screen.findByText("SCALE-256");

    expect(
      screen.queryByRole("button", {
        name: "settings:projectInfrastructure.models.add",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings:projectInfrastructure.hosts.add",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /\.(editAction|renameAction|deleteAction)/,
      }),
    ).toBeNull();
  });

  it("renders nothing without infrastructure read access", () => {
    permissions.read = false;
    renderPage();
    expect(
      screen.queryByText("settings:projectInfrastructure.title"),
    ).toBeNull();
    expect(getProjectModels).not.toHaveBeenCalled();
  });

  it("deletes a planned host only for the manager, after a confirmation", async () => {
    vi.mocked(deleteProjectHost).mockResolvedValue({ id: "host-planned" });
    const invalidate = renderPage();
    await screen.findByText("58%");

    // The installed host cannot be deleted.
    expect(
      screen.queryByRole("button", {
        name: "settings:projectInfrastructure.hosts.deleteAction SCALE-2",
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectInfrastructure.hosts.deleteAction SCALE-1",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(deleteProjectHost).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common:actions.delete" }),
    );

    await waitFor(() =>
      expect(deleteProjectHost).toHaveBeenCalledWith({
        projectId: "project-1",
        hostId: "host-planned",
      }),
    );
    // The whole feature refreshes: task VM lists show the host as gone too.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["infrastructure"],
      }),
    );
  });

  it("deletes a model after a confirmation", async () => {
    vi.mocked(deleteProjectModel).mockResolvedValue({ id: "model-1" });
    renderPage();
    await screen.findByText("SCALE-256");
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectInfrastructure.models.deleteAction SCALE-256",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(deleteProjectModel).toHaveBeenCalledWith({
        projectId: "project-1",
        modelId: "model-1",
      }),
    );
  });

  it("validates the model form and sends the parsed values", async () => {
    vi.mocked(createProjectModel).mockResolvedValue(model as never);
    renderPage();
    await screen.findByText("SCALE-256");
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectInfrastructure.models.add",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:projectInfrastructure.save",
      }),
    );
    // Name, RAM, vCPU and regions are empty.
    expect(
      await within(dialog).findAllByText(/projectInfrastructure\.validation\./),
    ).not.toHaveLength(0);
    expect(createProjectModel).not.toHaveBeenCalled();

    const field = (id: string) =>
      dialog.querySelector(`#${id}`) as HTMLInputElement;
    fireEvent.change(field("model-name"), { target: { value: "ADVANCE-2" } });
    fireEvent.change(field("model-ramGb"), { target: { value: "128" } });
    fireEvent.change(field("model-vcpu"), { target: { value: "16" } });
    // The catalog regions are checkboxes labelled "CODE — Name".
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: "GRA — Gravelines" }),
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "PAR — Paris" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:projectInfrastructure.save",
      }),
    );

    await waitFor(() =>
      expect(createProjectModel).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "ADVANCE-2",
        provider: "ovh",
        family: null,
        regions: ["GRA", "PAR"],
        ramGb: 128,
        vcpu: 16,
        storageGb: 0,
        leadTimeDays: 0,
        hypervisorReservePercent: 5,
      }),
    );
  });

  it("lists a model region outside the catalog so it can be unchecked", async () => {
    vi.mocked(getProjectRegions).mockResolvedValue([
      { code: "GRA", name: "Gravelines" },
    ]);
    renderPage();
    await screen.findByText("SCALE-256");
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectInfrastructure.models.editAction SCALE-256",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByRole("checkbox", { name: "GRA — Gravelines" }),
    ).toBeChecked();
    const orphan = within(dialog).getByRole("checkbox", {
      name: "PAR settings:projectInfrastructure.models.regionNotInCatalog",
    });
    expect(orphan).toBeChecked();
    // Unchecking drops the code from the model; it cannot come back, as it is
    // not in the catalog.
    fireEvent.click(orphan);
    expect(orphan).not.toBeInTheDocument();
  });

  it("shows a message and disables Save when the catalog is empty", async () => {
    vi.mocked(getProjectRegions).mockResolvedValue([]);
    renderPage();
    await screen.findByText("SCALE-256");
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectInfrastructure.models.add",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "settings:projectInfrastructure.models.regionsEmpty",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: "settings:projectInfrastructure.save",
      }),
    ).toBeDisabled();
  });

  it("adds several hosts with the quantity field and reports the count", async () => {
    vi.mocked(createProjectHost).mockResolvedValue({
      hosts: [plannedHost, installedHost, plannedHost],
    } as never);
    renderPage();
    await screen.findByText("58%");
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectInfrastructure.hosts.add",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText(
        "settings:projectInfrastructure.hosts.newModel",
      ),
      { target: { value: "model-1" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(
        "settings:projectInfrastructure.hosts.newRegion",
      ),
      { target: { value: "GRA" } },
    );
    const submit = within(dialog).getByRole("button", {
      name: "settings:projectInfrastructure.hosts.add",
    });
    // 51 is above the limit of the API.
    fireEvent.change(
      within(dialog).getByLabelText(
        "settings:projectInfrastructure.hosts.quantity",
      ),
      { target: { value: "51" } },
    );
    expect(submit).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText(
        "settings:projectInfrastructure.hosts.quantity",
      ),
      { target: { value: "3" } },
    );
    fireEvent.click(submit);

    await waitFor(() =>
      expect(createProjectHost).toHaveBeenCalledWith({
        projectId: "project-1",
        modelId: "model-1",
        region: "GRA",
        quantity: 3,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "settings:projectInfrastructure.hosts.added 3",
      ),
    );
  });
});
