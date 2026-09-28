import { HTTPException } from "hono/http-exception";
import {
  isCustomFieldValueEmpty,
  validateCustomFieldValue,
} from "../task/validate-task-fields";
import { validateOptionColors } from "./validate-option-colors";

export type CustomFieldCreateInput = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  optionColors?: Record<string, string>;
};

export type NormalizedCustomFieldCreateInput = {
  storedDefaultValue: string | null;
  options: string[] | null;
  optionColors: Record<string, string> | null;
};

/**
 * Shared validation for creating a custom field definition, whether
 * project-scoped or workspace-scoped — the field shape rules (required
 * needs a default, dropdown/multiselect option constraints, default-value
 * type-checking) don't depend on scope. Throws HTTPException(400) on any
 * invalid combination; otherwise returns the normalized values ready to
 * insert.
 */
export function validateCustomFieldCreateInput({
  name,
  type,
  required,
  defaultValue,
  options,
  optionColors,
}: CustomFieldCreateInput): NormalizedCustomFieldCreateInput {
  if (!name.trim())
    throw new HTTPException(400, { message: "Name cannot be empty" });

  if (
    required &&
    (defaultValue === undefined ||
      defaultValue === null ||
      defaultValue.trim() === "")
  ) {
    throw new HTTPException(400, {
      message: "Required fields must have a default value",
    });
  }

  if (defaultValue !== undefined && defaultValue !== null) {
    const trimmedValue = defaultValue.trim();

    if (trimmedValue) {
      if (type === "number") {
        const numberRegex = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
        if (!numberRegex.test(trimmedValue)) {
          throw new HTTPException(400, {
            message:
              "Default value must be a valid number for number type fields",
          });
        }
        const parsed = Number(trimmedValue);
        if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
          throw new HTTPException(400, {
            message:
              "Default value must be a valid number for number type fields",
          });
        }
      } else if (type === "boolean") {
        if (trimmedValue !== "true" && trimmedValue !== "false") {
          throw new HTTPException(400, {
            message:
              "Default value must be 'true' or 'false' for boolean type fields",
          });
        }
      } else if (type === "date") {
        const error = validateCustomFieldValue(trimmedValue, "date", name);
        if (error) {
          throw new HTTPException(400, { message: error });
        }
      } else if (type === "dropdown") {
        if (options && options.length > 0) {
          const normalizedOptions = options.map((opt) => opt.trim());
          if (!normalizedOptions.includes(trimmedValue)) {
            throw new HTTPException(400, {
              message: "Default value must be one of the dropdown options",
            });
          }
        }
      }
    }
  }

  if (type === "dropdown" && (!options || options.length < 1)) {
    throw new HTTPException(400, {
      message: "Dropdown fields must have at least one option",
    });
  }

  if (optionColors && type !== "dropdown") {
    throw new HTTPException(400, {
      message: "Option colors are only supported for dropdown fields",
    });
  }

  if (type === "dropdown") {
    validateOptionColors(options, optionColors);
  }

  if (type === "multiselect") {
    const normalizedOptions = Array.from(
      new Set(
        (options ?? [])
          .map((opt) => opt.trim())
          .filter((opt) => opt.length > 0),
      ),
    );

    if (normalizedOptions.length < 2) {
      throw new HTTPException(400, {
        message: "Multiselect fields must have at least 2 options",
      });
    }
  }

  if (type === "multiselect" && defaultValue != null) {
    const empty = isCustomFieldValueEmpty(defaultValue, "multiselect");
    if (required && empty) {
      throw new HTTPException(400, {
        message: "Required fields must have a default value",
      });
    }
    if (!empty) {
      const error = validateCustomFieldValue(
        defaultValue,
        "multiselect",
        name,
        options,
      );
      if (error) {
        throw new HTTPException(400, { message: error });
      }
    }
  }

  const storedDefaultValue =
    type === "date" ? defaultValue?.trim() : defaultValue;

  return {
    storedDefaultValue: storedDefaultValue ?? null,
    options: options ?? null,
    optionColors: type === "dropdown" ? (optionColors ?? null) : null,
  };
}
