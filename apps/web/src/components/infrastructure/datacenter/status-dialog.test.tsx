import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusDialog } from "./status-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast }));

// The Select popup cannot be driven in jsdom; a native select has the same
// contract (value, options, change).
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

function renderDialog(
  onSubmit = vi.fn().mockResolvedValue(undefined),
  initial: {
    status: "planned" | "ordered" | "installed";
    availableFrom: string | null;
    hostname: string | null;
  } = { status: "planned", availableFrom: null, hostname: null },
) {
  const onOpenChange = vi.fn();
  render(
    <StatusDialog
      open
      onOpenChange={onOpenChange}
      subject="ADVANCE-2 256 GB GRA #1"
      initial={initial}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

const save = () =>
  screen.getByRole("button", { name: "workspace:datacenter.actions.save" });
const statusSelect = () =>
  screen.getByLabelText("workspace:datacenter.fields.status");
const dateInput = () =>
  screen.getByLabelText("workspace:datacenter.fields.availableFrom");

describe("StatusDialog", () => {
  it("requires an expected delivery date for ordered", () => {
    renderDialog();

    fireEvent.change(statusSelect(), { target: { value: "ordered" } });
    expect(save()).toBeDisabled();

    fireEvent.change(dateInput(), { target: { value: "2026-11-30" } });
    expect(save()).toBeEnabled();
  });

  it("sends the ordered payload with the date and hostname, then closes", async () => {
    const { onSubmit, onOpenChange } = renderDialog();

    fireEvent.change(statusSelect(), { target: { value: "ordered" } });
    fireEvent.change(dateInput(), { target: { value: "2026-11-30" } });
    fireEvent.change(
      screen.getByLabelText("workspace:datacenter.fields.hostname"),
      { target: { value: "  gra-host-1 " } },
    );
    fireEvent.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      status: "ordered",
      availableFrom: "2026-11-30",
      hostname: "gra-host-1",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("lets installed go without a date and clears it for planned", async () => {
    const { onSubmit } = renderDialog(undefined, {
      status: "ordered",
      availableFrom: "2026-11-30",
      hostname: null,
    });

    fireEvent.change(dateInput(), { target: { value: "" } });
    fireEvent.change(statusSelect(), { target: { value: "installed" } });
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenLastCalledWith({
      status: "installed",
      availableFrom: undefined,
      hostname: null,
    });

    fireEvent.change(statusSelect(), { target: { value: "planned" } });
    expect(dateInput()).toBeDisabled();
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit).toHaveBeenLastCalledWith({
      status: "planned",
      availableFrom: null,
      hostname: null,
    });
  });

  it("keeps the dialog open and toasts a translated message for an API error code", async () => {
    const error = Object.assign(new Error("English message"), {
      code: "INFRA_AVAILABLE_FROM_REQUIRED",
    });
    const { onOpenChange } = renderDialog(vi.fn().mockRejectedValue(error), {
      status: "ordered",
      availableFrom: "2026-11-30",
      hostname: null,
    });

    fireEvent.click(save());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "workspace:datacenter.errors.availableFromRequired",
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
