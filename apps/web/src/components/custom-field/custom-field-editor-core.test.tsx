import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomFieldEditorCore from "./custom-field-editor-core";
import type { CustomFieldDefinition } from "./types";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function field(overrides: Partial<CustomFieldDefinition> = {}) {
  return {
    id: "field-1",
    projectId: "project-1",
    workspaceId: null,
    scope: "project" as const,
    hideable: false,
    hidden: false,
    name: "Severity",
    type: "text" as const,
    required: false,
    defaultValue: null,
    options: null,
    optionColors: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("CustomFieldEditorCore", () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the empty state when there are no fields", () => {
    render(
      <CustomFieldEditorCore
        fields={[]}
        isLoading={false}
        onCreate={vi.fn()}
        creating={false}
        onDelete={vi.fn()}
        deleting={false}
        onReorder={vi.fn()}
        onUpdateOptionColor={vi.fn()}
      />,
    );

    expect(screen.getByText("settings:customFields.empty")).toBeInTheDocument();
  });

  it("renders each provided field", () => {
    render(
      <CustomFieldEditorCore
        fields={[
          field({ id: "a", name: "Severity" }),
          field({
            id: "b",
            name: "Story points",
          }),
        ]}
        isLoading={false}
        onCreate={vi.fn()}
        creating={false}
        onDelete={vi.fn()}
        deleting={false}
        onReorder={vi.fn()}
        onUpdateOptionColor={vi.fn()}
      />,
    );

    expect(screen.getByText("Severity")).toBeInTheDocument();
    expect(screen.getByText("Story points")).toBeInTheDocument();
  });

  it("creates a field with the typed name", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <CustomFieldEditorCore
        fields={[]}
        isLoading={false}
        onCreate={onCreate}
        creating={false}
        onDelete={vi.fn()}
        deleting={false}
        onReorder={vi.fn()}
        onUpdateOptionColor={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("settings:customFields.namePlaceholder"),
      { target: { value: "Story points" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings:customFields.addButton" }),
    );

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Story points",
        type: "text",
        required: false,
      }),
    );
  });

  it("deletes a field when its delete button is clicked", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <CustomFieldEditorCore
        fields={[field({ id: "field-1", name: "Severity" })]}
        isLoading={false}
        onCreate={vi.fn()}
        creating={false}
        onDelete={onDelete}
        deleting={false}
        onReorder={vi.fn()}
        onUpdateOptionColor={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:customFields.deleteButton",
      }),
    );

    expect(onDelete).toHaveBeenCalledWith("field-1");
  });
});
