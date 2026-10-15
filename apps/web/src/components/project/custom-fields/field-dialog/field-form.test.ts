import { describe, expect, it } from "vite-plus/test";
import {
  addOption,
  EMPTY_FIELD_FORM,
  type FieldFormState,
  formFromField,
  getFormIssue,
  moveOption,
  removeOption,
  renameOption,
  setKind,
  setMultiple,
  setOptionColor,
  toCreatePayload,
  toUpdatePayload,
} from "@/components/project/custom-fields/field-dialog/field-form";
import type { CustomFieldDefinition } from "@/components/project/custom-fields/types";

const dropdown: FieldFormState = {
  ...EMPTY_FIELD_FORM,
  kind: "dropdown",
  name: "Size",
  options: ["Small", "Medium", "Large"],
  defaultValue: "Medium",
};

function definition(
  overrides: Partial<CustomFieldDefinition>,
): CustomFieldDefinition {
  return {
    id: "f1",
    projectId: "p1",
    name: "Field",
    type: "text",
    required: false,
    defaultValue: null,
    options: null,
    position: 0,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("formFromField", () => {
  it("starts empty for a new field", () => {
    expect(formFromField(null)).toBe(EMPTY_FIELD_FORM);
  });

  it("reads a multiselect field as a dropdown that allows several", () => {
    expect(
      formFromField(
        definition({
          type: "multiselect",
          options: ["iOS", "Web"],
          defaultValue: '["Web"]',
        }),
      ),
    ).toMatchObject({
      kind: "dropdown",
      multiple: true,
      defaultValue: "",
      defaultValues: ["Web"],
    });
  });

  it("reads a checkbox without a default as unchecked", () => {
    expect(formFromField(definition({ type: "boolean" })).defaultValue).toBe(
      "false",
    );
  });
});

describe("options", () => {
  it("adds trimmed options once", () => {
    const next = addOption(addOption(dropdown, "  XL "), "XL");
    expect(next.options).toEqual(["Small", "Medium", "Large", "XL"]);
    expect(addOption(dropdown, "   ")).toBe(dropdown);
  });

  it("drops the default with a removed option", () => {
    expect(removeOption(dropdown, "Medium")).toMatchObject({
      options: ["Small", "Large"],
      defaultValue: "",
    });
  });

  it("renames the default with its option and refuses duplicates", () => {
    expect(renameOption(dropdown, "Medium", " M ")).toMatchObject({
      options: ["Small", "M", "Large"],
      defaultValue: "M",
    });
    expect(renameOption(dropdown, "Medium", "Small")).toBe(dropdown);
    expect(renameOption(dropdown, "Medium", " ")).toBe(dropdown);
  });

  it("reorders options", () => {
    expect(moveOption(dropdown, 2, 0).options).toEqual([
      "Large",
      "Small",
      "Medium",
    ]);
  });
});

describe("type changes", () => {
  it("resets the default when the type changes", () => {
    expect(setKind(dropdown, "boolean")).toMatchObject({
      kind: "boolean",
      defaultValue: "false",
      multiple: false,
    });
  });

  it("carries the default across allowing several", () => {
    const multiple = setMultiple(dropdown, true);
    expect(multiple).toMatchObject({
      defaultValue: "",
      defaultValues: ["Medium"],
    });
    expect(setMultiple(multiple, false)).toMatchObject({
      defaultValue: "Medium",
      defaultValues: [],
    });
  });
});

describe("getFormIssue", () => {
  it("needs a name", () => {
    expect(getFormIssue({ ...dropdown, name: "  " })).toBe("nameRequired");
  });

  it("needs one option, or two when several are allowed", () => {
    expect(getFormIssue({ ...dropdown, options: [], defaultValue: "" })).toBe(
      "optionsRequired",
    );
    expect(
      getFormIssue({ ...dropdown, multiple: true, options: ["Small"] }),
    ).toBe("moreOptionsRequired");
  });

  it("needs a default for required fields", () => {
    expect(
      getFormIssue({ ...EMPTY_FIELD_FORM, name: "Customer", required: true }),
    ).toBe("defaultRequired");
    expect(
      getFormIssue({
        ...dropdown,
        multiple: true,
        required: true,
        defaultValue: "",
        defaultValues: [],
      }),
    ).toBe("defaultRequired");
    expect(getFormIssue({ ...dropdown, required: true })).toBeNull();
  });
});

describe("payloads", () => {
  it("creates a multiselect with a JSON default", () => {
    expect(
      toCreatePayload(
        {
          ...dropdown,
          multiple: true,
          defaultValue: "",
          defaultValues: ["Small"],
        },
        "p1",
      ),
    ).toEqual({
      projectId: "p1",
      name: "Size",
      type: "multiselect",
      required: false,
      defaultValue: '["Small"]',
      options: ["Small", "Medium", "Large"],
    });
  });

  it("leaves options out of other types and clears empty defaults", () => {
    expect(
      toUpdatePayload({
        ...EMPTY_FIELD_FORM,
        kind: "number",
        name: " Estimate ",
      }),
    ).toEqual({
      name: "Estimate",
      required: false,
      defaultValue: null,
    });
  });

  describe("option colours", () => {
    const sized = {
      ...EMPTY_FIELD_FORM,
      kind: "dropdown" as const,
      name: "Size",
      options: ["Small", "Large"],
    };

    it("keeps colours only for a single-select dropdown", () => {
      expect(setOptionColor(sized, "Small", "red").optionColors).toEqual({
        Small: "red",
      });
      const multiple = setMultiple(sized, true);
      expect(setOptionColor(multiple, "Small", "red")).toBe(multiple);
      expect(
        setMultiple(setOptionColor(sized, "Small", "red"), true),
      ).toMatchObject({
        optionColors: {},
      });
    });

    it("moves a colour along with a renamed option and drops it with a removed one", () => {
      const coloured = setOptionColor(sized, "Small", "red");
      expect(renameOption(coloured, "Small", "Tiny").optionColors).toEqual({
        Tiny: "red",
      });
      expect(removeOption(coloured, "Small").optionColors).toEqual({});
    });

    it("creates with the colours of the options it has", () => {
      expect(
        toCreatePayload(setOptionColor(sized, "Large", "blue"), "p1"),
      ).toMatchObject({
        options: ["Small", "Large"],
        optionColors: { Large: "blue" },
      });
    });

    it("sends colours on update only when one changed, and never the type", () => {
      const field = definition({
        type: "dropdown",
        options: ["Small", "Large"],
        optionColors: { Small: "red" },
      });
      const unchanged = formFromField(field);
      expect(toUpdatePayload(unchanged, field)).not.toHaveProperty(
        "optionColors",
      );
      expect(toUpdatePayload(unchanged, field)).not.toHaveProperty("type");

      const changed = setOptionColor(unchanged, "Large", "blue");
      expect(toUpdatePayload(changed, field)).toMatchObject({
        optionColors: { Small: "red", Large: "blue" },
      });
    });
  });
});
