import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
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
        onUpdate={vi.fn()}
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
        onUpdate={vi.fn()}
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
        onUpdate={vi.fn()}
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
        onUpdate={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:customFields.deleteButton",
      }),
    );

    expect(onDelete).toHaveBeenCalledWith("field-1");
  });

  describe("editing a field", () => {
    const EDIT_LABEL = "settings:customFields.editFieldAriaLabel";
    const FORM_LABEL = "settings:customFields.editFormAriaLabel";

    function renderEditable(
      fields: CustomFieldDefinition[],
      onUpdate = vi.fn().mockResolvedValue(undefined),
    ) {
      render(
        <CustomFieldEditorCore
          fields={fields}
          isLoading={false}
          onCreate={vi.fn()}
          creating={false}
          onDelete={vi.fn()}
          deleting={false}
          onReorder={vi.fn()}
          onUpdateOptionColor={vi.fn()}
          onUpdate={onUpdate}
        />,
      );
      return onUpdate;
    }

    function openEditor(index = 0) {
      fireEvent.click(
        screen.getAllByRole("button", { name: EDIT_LABEL })[index],
      );
      return screen.getByRole("form", { name: FORM_LABEL });
    }

    beforeEach(() => {
      vi.mocked(toast.success).mockClear();
      vi.mocked(toast.error).mockClear();
    });

    it("saves the changed name, default value and required flag", async () => {
      const onUpdate = renderEditable([
        field({ id: "field-1", name: "Severity" }),
      ]);
      const form = openEditor();

      fireEvent.change(
        within(form).getByLabelText("settings:customFields.nameLabel"),
        {
          target: { value: "  Urgency " },
        },
      );
      fireEvent.change(
        within(form).getByRole("textbox", {
          name: "settings:customFields.defaultValueLabel",
        }),
        { target: { value: "n/a" } },
      );
      fireEvent.click(
        within(form).getByRole("checkbox", {
          name: "settings:customFields.required",
        }),
      );
      fireEvent.click(
        within(form).getByRole("button", {
          name: "settings:customFields.saveButton",
        }),
      );

      await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
      expect(onUpdate).toHaveBeenCalledWith("field-1", {
        name: "Urgency",
        required: true,
        defaultValue: "n/a",
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("form", { name: FORM_LABEL }),
        ).not.toBeInTheDocument(),
      );
      expect(toast.success).toHaveBeenCalledWith(
        "settings:customFields.updateSuccess",
      );
    });

    it("sends the full normalized options list of a dropdown", async () => {
      const onUpdate = renderEditable([
        field({
          id: "field-1",
          type: "dropdown",
          options: ["low", "high"],
          optionColors: { low: "green" },
        }),
      ]);
      const form = openEditor();

      const options = within(form).getByLabelText(
        "settings:customFields.optionsLabel",
      );
      expect(options).toHaveValue("low, high");
      fireEvent.change(options, { target: { value: " high, urgent ,high,," } });
      fireEvent.click(
        within(form).getByRole("button", {
          name: "settings:customFields.saveButton",
        }),
      );

      await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
      expect(onUpdate).toHaveBeenCalledWith("field-1", {
        options: ["high", "urgent"],
      });
    });

    describe("option colors", () => {
      const SWATCH = "settings:customFields.optionColorAriaLabel";
      const SAVE = "settings:customFields.saveButton";
      const colored = () =>
        field({
          id: "field-1",
          type: "dropdown",
          options: ["low", "high"],
          optionColors: { low: "green", high: "red" },
        });

      it("shows the stored color of each option while editing", () => {
        renderEditable([colored()]);
        const form = openEditor();

        const swatches = within(form).getAllByRole("button", { name: SWATCH });
        expect(swatches).toHaveLength(2);
        expect(swatches[0].style.backgroundColor).not.toBe("");
        expect(swatches[1].style.backgroundColor).not.toBe("");
        expect(swatches[0].style.backgroundColor).not.toBe(
          swatches[1].style.backgroundColor,
        );
        expect(
          within(form).getByText("settings:customFields.optionColorsLabel"),
        ).toBeInTheDocument();
        expect(within(form).getByText("low")).toBeInTheDocument();
        expect(within(form).getByText("high")).toBeInTheDocument();
      });

      it("sends the changed color of an option on save", async () => {
        const onUpdate = renderEditable([colored()]);
        const form = openEditor();

        fireEvent.click(
          within(form).getAllByRole("button", { name: SWATCH })[0],
        );
        fireEvent.click(
          await screen.findByRole("button", { name: "Lavender" }),
        );
        fireEvent.click(within(form).getByRole("button", { name: SAVE }));

        await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
        expect(onUpdate).toHaveBeenCalledWith("field-1", {
          optionColors: { low: "purple", high: "red" },
        });
      });

      it("sends the colors together with a changed options list", async () => {
        const onUpdate = renderEditable([colored()]);
        const form = openEditor();

        fireEvent.change(
          within(form).getByLabelText("settings:customFields.optionsLabel"),
          { target: { value: "low, urgent" } },
        );
        // "high" was removed and "urgent" is new and uncolored.
        const swatches = within(form).getAllByRole("button", { name: SWATCH });
        expect(swatches).toHaveLength(2);
        expect(swatches[1].style.backgroundColor).toBe("");
        fireEvent.click(swatches[1]);
        fireEvent.click(await screen.findByRole("button", { name: "Amber" }));
        fireEvent.click(within(form).getByRole("button", { name: SAVE }));

        await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
        expect(onUpdate).toHaveBeenCalledWith("field-1", {
          options: ["low", "urgent"],
          optionColors: { low: "green", urgent: "yellow" },
        });
      });

      it("drops the color of a removed option without sending a color change", async () => {
        const onUpdate = renderEditable([colored()]);
        const form = openEditor();

        fireEvent.change(
          within(form).getByLabelText("settings:customFields.optionsLabel"),
          { target: { value: "low" } },
        );
        expect(
          within(form).getAllByRole("button", { name: SWATCH }),
        ).toHaveLength(1);
        fireEvent.click(within(form).getByRole("button", { name: SAVE }));

        await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
        // The API prunes the colors of removed options when none are sent.
        expect(onUpdate).toHaveBeenCalledWith("field-1", { options: ["low"] });
      });

      it("offers no color controls for a multiselect field", () => {
        renderEditable([
          field({
            id: "field-1",
            type: "multiselect",
            options: ["a", "b"],
          }),
        ]);
        const form = openEditor();

        expect(
          within(form).queryByRole("button", { name: SWATCH }),
        ).not.toBeInTheDocument();
      });
    });

    it("clears the stored default when it is emptied", async () => {
      const onUpdate = renderEditable([
        field({ id: "field-1", defaultValue: "n/a" }),
      ]);
      const form = openEditor();

      fireEvent.change(
        within(form).getByRole("textbox", {
          name: "settings:customFields.defaultValueLabel",
        }),
        { target: { value: "" } },
      );
      fireEvent.click(
        within(form).getByRole("button", {
          name: "settings:customFields.saveButton",
        }),
      );

      await waitFor(() =>
        expect(onUpdate).toHaveBeenCalledWith("field-1", {
          defaultValue: null,
        }),
      );
    });

    it("shows the type read-only and offers no type control", () => {
      renderEditable([field({ type: "number" })]);
      const form = openEditor();

      expect(
        within(form).getByText("settings:customFields.types.number"),
      ).toBeInTheDocument();
      expect(
        within(form).queryByRole("combobox", {
          name: "settings:customFields.typeLabel",
        }),
      ).not.toBeInTheDocument();
    });

    it("does not call onUpdate when cancelled", () => {
      const onUpdate = renderEditable([field({ id: "field-1" })]);
      const form = openEditor();

      fireEvent.change(
        within(form).getByLabelText("settings:customFields.nameLabel"),
        {
          target: { value: "Changed" },
        },
      );
      fireEvent.click(
        within(form).getByRole("button", {
          name: "settings:customFields.cancelButton",
        }),
      );

      expect(onUpdate).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("form", { name: FORM_LABEL }),
      ).not.toBeInTheDocument();
      // The stored name is shown again, not the draft.
      expect(screen.getByText("Severity")).toBeInTheDocument();
    });

    it("cancels on Escape without calling onUpdate", () => {
      const onUpdate = renderEditable([field({ id: "field-1" })]);
      const form = openEditor();

      fireEvent.keyDown(
        within(form).getByLabelText("settings:customFields.nameLabel"),
        {
          key: "Escape",
        },
      );

      expect(onUpdate).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("form", { name: FORM_LABEL }),
      ).not.toBeInTheDocument();
    });

    it("closes without a request when nothing changed", () => {
      const onUpdate = renderEditable([field({ id: "field-1" })]);
      const form = openEditor();

      fireEvent.click(
        within(form).getByRole("button", {
          name: "settings:customFields.saveButton",
        }),
      );

      expect(onUpdate).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("form", { name: FORM_LABEL }),
      ).not.toBeInTheDocument();
    });

    it("blocks saving an empty name, a required field without default, or too few options", () => {
      renderEditable([
        field({ id: "a", name: "Plain" }),
        field({
          id: "b",
          name: "Tags",
          type: "multiselect",
          options: ["x", "y"],
        }),
      ]);

      let form = openEditor(0);
      const save = () =>
        within(form).getByRole("button", {
          name: "settings:customFields.saveButton",
        });
      fireEvent.change(
        within(form).getByLabelText("settings:customFields.nameLabel"),
        {
          target: { value: "  " },
        },
      );
      expect(save()).toBeDisabled();
      fireEvent.change(
        within(form).getByLabelText("settings:customFields.nameLabel"),
        {
          target: { value: "Plain" },
        },
      );
      expect(save()).toBeEnabled();
      fireEvent.click(
        within(form).getByRole("checkbox", {
          name: "settings:customFields.required",
        }),
      );
      expect(save()).toBeDisabled();

      fireEvent.click(
        within(form).getByRole("button", {
          name: "settings:customFields.cancelButton",
        }),
      );
      form = openEditor(1);
      fireEvent.change(
        within(form).getByLabelText("settings:customFields.optionsLabel"),
        { target: { value: "x, x" } },
      );
      expect(save()).toBeDisabled();
    });

    it("allows one row in edit mode at a time and disables dragging meanwhile", () => {
      renderEditable([
        field({ id: "a", name: "First" }),
        field({ id: "b", name: "Second" }),
      ]);
      const rows = () => screen.getAllByRole("listitem");
      expect(rows()[0]).toHaveAttribute("draggable", "true");

      openEditor(0);

      expect(screen.getAllByRole("form")).toHaveLength(1);
      // The other row's Edit button is unavailable until this edit ends.
      expect(screen.getByRole("button", { name: EDIT_LABEL })).toBeDisabled();
      for (const row of rows()) {
        expect(row).not.toHaveAttribute("draggable", "true");
      }
    });

    it("stays in edit mode and reports the error when saving fails", async () => {
      const onUpdate = vi
        .fn()
        .mockRejectedValue(new Error("Cannot remove option(s): mid"));
      renderEditable([field({ id: "field-1" })], onUpdate);
      const form = openEditor();

      fireEvent.change(
        within(form).getByLabelText("settings:customFields.nameLabel"),
        {
          target: { value: "Renamed" },
        },
      );
      fireEvent.click(
        within(form).getByRole("button", {
          name: "settings:customFields.saveButton",
        }),
      );

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Cannot remove option(s): mid",
        ),
      );
      expect(
        screen.getByRole("form", { name: FORM_LABEL }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("form", { name: FORM_LABEL })).getByLabelText(
          "settings:customFields.nameLabel",
        ),
      ).toHaveValue("Renamed");
    });
  });
});
