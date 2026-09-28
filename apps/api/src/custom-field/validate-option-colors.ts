import { HTTPException } from "hono/http-exception";

/**
 * A dropdown/multiselect field's option colors must only reference option
 * values the field actually has (mirrors the existing default-value/options
 * checks in create-custom-field.ts). `options` is untyped jsonb read back
 * from the database, so it's normalized defensively rather than trusted.
 */
export function validateOptionColors(
  options: unknown,
  optionColors: Record<string, string> | null | undefined,
) {
  if (!optionColors) return;

  const normalizedOptions = new Set(
    (Array.isArray(options) ? options : [])
      .filter((option): option is string => typeof option === "string")
      .map((option) => option.trim()),
  );

  const unknownKeys = Object.keys(optionColors).filter(
    (key) => !normalizedOptions.has(key),
  );

  if (unknownKeys.length > 0) {
    throw new HTTPException(400, {
      message: `Option colors reference unknown option(s): ${unknownKeys.join(", ")}`,
    });
  }
}
