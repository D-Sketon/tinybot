import Ajv from "ajv";
const ajv = new Ajv({ allErrors: true });

export interface ToolSchema {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

/**
 * Defines the shared contract and argument validation flow for all tools.
 */
export abstract class BaseTool {
  name = "";
  description = "";
  schema = {} as ToolSchema;

  abstract execute(args: Record<string, unknown>): Promise<string>;
  validate(args: Record<string, unknown>): string[] {
    try {
      const validator = ajv.compile(this.schema.parameters || {});
      const valid = validator(args);
      if (valid) return [];
      return (
        validator.errors?.map((err) => {
          const path = err.instancePath ? err.instancePath.slice(1) : "";
          const label = path ? `Value at '${path}'` : "Value";
          if (err.keyword === "type") {
            const expectedType = (err.params as { type: string }).type;
            return `${label} should be ${expectedType}`;
          }
          if (err.keyword === "enum") {
            const allowedValues = (err.params as { allowedValues: unknown[] })
              .allowedValues;
            return `${label} must be one of ${JSON.stringify(allowedValues)}`;
          }
          return `${label} ${err.message}`;
        }) || []
      );
    } catch (e) {
      return [`Schema is invalid: ${(e as Error).message}`];
    }
  }
}

/**
 * Returns a string value when the input is a string.
 */
export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Returns a string array value when the input is a string-only array.
 */
export function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? value : undefined;
}
