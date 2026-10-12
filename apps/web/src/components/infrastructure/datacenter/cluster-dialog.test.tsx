import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClusterDialog } from "./cluster-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// A native select has the same contract as the Select popup (value, options,
// change) and can be driven in jsdom.
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

afterEach(cleanup);

const label = (key: string) => screen.queryByLabelText(`workspace:${key}`);

function renderDialog(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<ClusterDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);
  return onSubmit;
}

describe("ClusterDialog", () => {
  it("shows the erasure coding fields only for a self-managed cluster", () => {
    renderDialog();

    expect(label("datacenter.fields.dataChunks")).toBeInTheDocument();
    expect(label("datacenter.fields.codingChunks")).toBeInTheDocument();

    fireEvent.change(label("datacenter.fields.kind") as HTMLElement, {
      target: { value: "managed_service" },
    });
    expect(label("datacenter.fields.dataChunks")).not.toBeInTheDocument();
    expect(label("datacenter.fields.codingChunks")).not.toBeInTheDocument();

    fireEvent.change(label("datacenter.fields.kind") as HTMLElement, {
      target: { value: "self_managed" },
    });
    expect(label("datacenter.fields.dataChunks")).toBeInTheDocument();
  });

  it("sends k and m for a self-managed cluster and none for a managed service", async () => {
    const onSubmit = renderDialog();
    const save = () =>
      screen.getByRole("button", { name: "workspace:datacenter.actions.save" });

    expect(save()).toBeDisabled();
    fireEvent.change(label("datacenter.fields.name") as HTMLElement, {
      target: { value: "Ceph GRA" },
    });
    fireEvent.change(label("datacenter.fields.region") as HTMLElement, {
      target: { value: "gra" },
    });
    expect(save()).toBeEnabled();
    fireEvent.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenLastCalledWith({
      name: "Ceph GRA",
      region: "GRA",
      kind: "self_managed",
      ecDataChunks: 4,
      ecCodingChunks: 2,
      fillThresholdPercent: 80,
      leadTimeDays: 0,
    });

    fireEvent.change(label("datacenter.fields.kind") as HTMLElement, {
      target: { value: "managed_service" },
    });
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "managed_service",
        ecDataChunks: null,
        ecCodingChunks: null,
      }),
    );
  });

  it("does not save a self-managed cluster without valid k and m", () => {
    renderDialog();
    fireEvent.change(label("datacenter.fields.name") as HTMLElement, {
      target: { value: "Ceph GRA" },
    });
    fireEvent.change(label("datacenter.fields.region") as HTMLElement, {
      target: { value: "GRA" },
    });
    fireEvent.change(label("datacenter.fields.dataChunks") as HTMLElement, {
      target: { value: "0" },
    });

    expect(
      screen.getByRole("button", { name: "workspace:datacenter.actions.save" }),
    ).toBeDisabled();
  });
});
