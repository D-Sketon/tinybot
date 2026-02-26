import { describe, expect, it, vi } from "vitest";

// Mock Ajv to throw during compile to exercise the catch branch in validate
vi.doMock("ajv", () => {
  return {
    default: class {
      constructor() {}
      compile() {
        throw new Error("compile boom");
      }
    },
  };
});

describe("baseTool validate schema compile error", () => {
  it("returns schema invalid error when Ajv.compile throws", async () => {
    const mod = await import("../../../src/core/tools/base.ts");
    const Dummy = class extends (mod as any).BaseTool {
      async execute() {
        return "";
      }
    };
    const inst = new Dummy();
    inst.schema = { name: "x", description: "x", parameters: {} } as any;
    const errs = inst.validate({});
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain("Schema is invalid");
  });
});
