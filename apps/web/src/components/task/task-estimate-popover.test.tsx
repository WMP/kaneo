import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type Task from "@/types/task";
import TaskEstimatePopover from "./task-estimate-popover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const updateTask = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const canUpdateTasks = vi.fn(() => true);

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: updateTask }),
}));

vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateTasks: () => canUpdateTasks() }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Directly loaded task",
    number: 1,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    progress: 0,
    isMilestone: false,
    baselineStartDate: null,
    baselineDueDate: null,
    position: 1,
    createdAt: "2026-07-17T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    ...overrides,
  };
}

async function openPopover(task: Task) {
  render(
    <TaskEstimatePopover task={task}>
      <Button>Estimate</Button>
    </TaskEstimatePopover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
  return screen.findByRole("textbox", {
    name: "tasks:popover.estimate.amountLabel",
  });
}

describe("TaskEstimatePopover", () => {
  it("saves a decimal number of hours as whole minutes", async () => {
    updateTask.mockResolvedValue(undefined);
    const input = await openPopover(makeTask());
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.blur(input);

    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "task-1",
        estimateMinutes: 90,
        estimateUnit: "hours",
      }),
    );
    await vi.waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "tasks:popover.estimate.updateSuccess",
      ),
    );
  });

  it("saves half a work day as 240 minutes in days", async () => {
    updateTask.mockResolvedValue(undefined);
    const input = await openPopover(makeTask());

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:popover.estimate.units.days" }),
    );
    fireEvent.change(input, { target: { value: "0.5" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ estimateMinutes: 240, estimateUnit: "days" }),
    );
  });

  it("does not save twice when Enter is followed by a blur", async () => {
    updateTask.mockResolvedValue(undefined);
    const input = await openPopover(makeTask());

    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(updateTask).toHaveBeenCalledTimes(1);
  });

  it("shows the stored minutes in the stored unit", async () => {
    const input = await openPopover(
      makeTask({ estimateMinutes: 960, estimateUnit: "days" }),
    );

    expect(input).toHaveValue("2");
    expect(
      screen.getByRole("button", { name: "tasks:popover.estimate.units.days" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("re-expresses the same estimate when the unit changes", async () => {
    updateTask.mockResolvedValue(undefined);
    const input = await openPopover(
      makeTask({ estimateMinutes: 480, estimateUnit: "hours" }),
    );
    expect(input).toHaveValue("8");

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:popover.estimate.units.days" }),
    );

    expect(input).toHaveValue("1");
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ estimateMinutes: 480, estimateUnit: "days" }),
    );
  });

  it("clears the estimate when the field is emptied", async () => {
    updateTask.mockResolvedValue(undefined);
    const input = await openPopover(
      makeTask({ estimateMinutes: 90, estimateUnit: "hours" }),
    );

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ estimateMinutes: null }),
    );
  });

  it("clears the estimate from the clear button", async () => {
    updateTask.mockResolvedValue(undefined);
    await openPopover(makeTask({ estimateMinutes: 90 }));

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:popover.estimate.clear" }),
    );

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ estimateMinutes: null }),
    );
  });

  it("reverts invalid text without saving", async () => {
    const input = await openPopover(
      makeTask({ estimateMinutes: 90, estimateUnit: "hours" }),
    );

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(updateTask).not.toHaveBeenCalled();
    expect(input).toHaveValue("1.5");
  });

  it("reverts the field and shows the error when saving fails", async () => {
    updateTask.mockRejectedValue(new Error("nope"));
    const input = await openPopover(makeTask());

    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("nope"));
    expect(input).toHaveValue("");
  });

  it("renders only its trigger for a viewer who cannot edit tasks", () => {
    canUpdateTasks.mockReturnValueOnce(false);
    render(
      <TaskEstimatePopover task={makeTask()}>
        <Button>Estimate</Button>
      </TaskEstimatePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));

    expect(
      screen.queryByRole("textbox", {
        name: "tasks:popover.estimate.amountLabel",
      }),
    ).not.toBeInTheDocument();
  });
});
