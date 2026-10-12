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
import getProjectCapacity from "@/fetchers/infrastructure/get-project-capacity";
import getProjectHosts from "@/fetchers/infrastructure/get-project-hosts";
import getProjectModels from "@/fetchers/infrastructure/get-project-models";
import getProjectStorageClusters from "@/fetchers/infrastructure/get-project-storage-clusters";
import getTaskVms from "@/fetchers/infrastructure/get-task-vms";
import replaceTaskVms from "@/fetchers/infrastructure/replace-task-vms";
import { toast } from "@/lib/toast";
import { TaskInfrastructureSection } from "./task-infrastructure-section";

vi.mock("@/fetchers/infrastructure/get-task-vms", () => ({ default: vi.fn() }));
vi.mock("@/fetchers/infrastructure/get-project-hosts", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/get-project-models", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/get-project-capacity", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/get-project-storage-clusters", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/replace-task-vms", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/create-project-host", () => ({
  default: vi.fn(),
}));

const canPlanInfrastructure = vi.fn(() => true);
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canPlanInfrastructure }),
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
// The real Select is a popup; a native select keeps the tests about behavior.
vi.mock("../infra-select", () => ({
  InfraSelect: ({
    value,
    onChange,
    options,
    ariaLabel,
    disabled,
  }: {
    value: string | null;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value ?? ""}
      disabled={disabled}
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

const vm = {
  id: "vm-1",
  taskId: "task-1",
  hostId: "host-1",
  name: "billing-db-1",
  vcpu: 8,
  ramGb: 64,
  localStorageGb: 100,
  cephStorageGb: 500,
  storageClusterId: null,
  position: 0,
  storageCluster: null,
  host: null,
};

const host = (id: string, label: string, region: string) => ({
  id,
  label,
  region,
  status: "ordered" as const,
  availableFrom: "2026-11-26",
  model: { name: "SCALE", ramGb: 256, storageGb: 1000 },
  totals: { vmCount: 1, localStorageGb: 100 },
});

const capacity = {
  today: "2026-10-12",
  hosts: [{ host: host("host-1", "SCALE-1", "PAR"), result: {} }],
  warnings: [
    {
      type: "HOST_NOT_READY",
      severity: "error",
      hostId: "host-1",
      vmId: "vm-1",
      vmName: "billing-db-1",
      taskId: "task-1",
      date: "2026-11-21",
    },
    {
      type: "VM_UNPLACED",
      severity: "warning",
      vmId: "vm-9",
      vmName: "other-task-vm",
      taskId: "task-2",
    },
  ],
  unplacedVms: [],
  unscheduledVms: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  canPlanInfrastructure.mockReturnValue(true);
  vi.mocked(getTaskVms).mockResolvedValue([vm] as never);
  vi.mocked(getProjectHosts).mockResolvedValue([
    host("host-1", "SCALE-1", "PAR"),
    host("host-2", "SCALE-2", "GRA"),
  ] as never);
  vi.mocked(getProjectStorageClusters).mockResolvedValue([
    { id: "cl-par", name: "ceph-par", region: "PAR", kind: "self_managed" },
    { id: "cl-gra", name: "ceph-gra", region: "GRA", kind: "managed_service" },
  ] as never);
  vi.mocked(getProjectCapacity).mockResolvedValue(capacity as never);
  vi.mocked(getProjectModels).mockResolvedValue([
    {
      id: "model-1",
      name: "SCALE",
      ramGb: 256,
      regions: ["PAR", "GRA"],
    },
  ] as never);
});
afterEach(cleanup);

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TaskInfrastructureSection taskId="task-1" projectId="project-1" />
    </QueryClientProvider>,
  );
}

const saveButton = () =>
  screen.getByRole("button", { name: "settings:projectInfrastructure.save" });

describe("task infrastructure section", () => {
  it("is read-only without the plan permission", async () => {
    canPlanInfrastructure.mockReturnValue(false);
    renderSection();

    expect(await screen.findByText("billing-db-1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "tasks:infrastructure.addVm" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings:projectInfrastructure.save",
      }),
    ).toBeNull();
    expect(screen.getByText(/SCALE-1 PAR/)).toBeInTheDocument();
  });

  it("shows only the warnings of this task", async () => {
    renderSection();
    const warning = await screen.findByText(
      /hostNotReadyAvailable billing-db-1 SCALE-1 Nov 21, 2026 Nov 26, 2026/,
    );
    expect(warning).toBeInTheDocument();
    expect(screen.queryByText(/other-task-vm/)).toBeNull();
  });

  it("keeps Save disabled until the list changes, then sends the whole list", async () => {
    vi.mocked(replaceTaskVms).mockResolvedValue([vm] as never);
    renderSection();

    const name = await screen.findByDisplayValue("billing-db-1");
    expect(saveButton()).toBeDisabled();

    fireEvent.change(name, { target: { value: "billing-db-a" } });
    fireEvent.change(screen.getByDisplayValue("64"), {
      target: { value: "128" },
    });
    fireEvent.change(
      screen.getByLabelText("tasks:infrastructure.columns.cluster"),
      {
        target: { value: "cl-par" },
      },
    );
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(replaceTaskVms).toHaveBeenCalledWith({
        taskId: "task-1",
        vms: [
          {
            id: "vm-1",
            name: "billing-db-a",
            vcpu: 8,
            ramGb: 128,
            cephStorageGb: 500,
            localStorageGb: 100,
            hostId: "host-1",
            storageClusterId: "cl-par",
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("tasks:infrastructure.saved"),
    );
  });

  it("restores the saved list on Cancel", async () => {
    renderSection();
    const name = await screen.findByDisplayValue("billing-db-1");
    fireEvent.change(name, { target: { value: "changed" } });
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(await screen.findByDisplayValue("billing-db-1")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("duplicates a row with the next name suffix and removes rows", async () => {
    vi.mocked(replaceTaskVms).mockResolvedValue([] as never);
    renderSection();
    await screen.findByDisplayValue("billing-db-1");

    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:infrastructure.duplicateRow 1",
      }),
    );
    expect(screen.getByDisplayValue("billing-db-2")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:infrastructure.removeRow 1" }),
    );
    fireEvent.click(saveButton());

    // The copy has no id: it is created, the removed row is left out.
    await waitFor(() =>
      expect(replaceTaskVms).toHaveBeenCalledWith({
        taskId: "task-1",
        vms: [
          {
            name: "billing-db-2",
            vcpu: 8,
            ramGb: 64,
            cephStorageGb: 500,
            localStorageGb: 100,
            hostId: "host-1",
            storageClusterId: null,
          },
        ],
      }),
    );
  });

  it("validates before saving and shows inline errors", async () => {
    renderSection();
    const name = await screen.findByDisplayValue("billing-db-1");
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.change(screen.getByDisplayValue("64"), {
      target: { value: "-3" },
    });
    fireEvent.click(saveButton());

    expect(
      await screen.findByText("tasks:infrastructure.validation.nameRequired"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tasks:infrastructure.validation.number"),
    ).toBeInTheDocument();
    expect(replaceTaskVms).not.toHaveBeenCalled();
  });

  it("offers only the Ceph clusters of the host's region", async () => {
    renderSection();
    await screen.findByDisplayValue("billing-db-1");
    const clusters = screen.getByLabelText(
      "tasks:infrastructure.columns.cluster",
    );
    const labels = within(clusters)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toContain("tasks:infrastructure.clusterOption ceph-par PAR");
    expect(labels.join()).not.toContain("ceph-gra");
  });

  it("creates a planned host from 'New host...' and selects it", async () => {
    vi.mocked(createProjectHost).mockResolvedValue(
      host("host-new", "SCALE 256 GB GRA #1", "GRA") as never,
    );
    vi.mocked(replaceTaskVms).mockResolvedValue([vm] as never);
    renderSection();
    await screen.findByDisplayValue("billing-db-1");

    fireEvent.change(
      screen.getByLabelText("tasks:infrastructure.columns.host"),
      {
        target: { value: "__new_host__" },
      },
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
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:projectInfrastructure.hosts.add",
      }),
    );

    await waitFor(() =>
      expect(createProjectHost).toHaveBeenCalledWith({
        projectId: "project-1",
        modelId: "model-1",
        region: "GRA",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("tasks:infrastructure.columns.host"),
      ).toHaveValue("host-new"),
    );

    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(replaceTaskVms).toHaveBeenCalledWith({
        taskId: "task-1",
        vms: [expect.objectContaining({ id: "vm-1", hostId: "host-new" })],
      }),
    );
  });

  it("reports a failed save and keeps the edits", async () => {
    vi.mocked(replaceTaskVms).mockRejectedValue(new Error("boom"));
    renderSection();
    const name = await screen.findByDisplayValue("billing-db-1");
    fireEvent.change(name, { target: { value: "kept" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByDisplayValue("kept")).toBeInTheDocument();
  });
});
