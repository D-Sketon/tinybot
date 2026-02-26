import type { BaseTool } from "../../../src/core/tools/base.ts";

import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../../../src/core/tools/registry.ts";

describe("toolRegistry", () => {
  it("returns error for unknown tool", async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute("missing", {})).rejects.toThrow(
      "tool missing is not registered.",
    );
  });

  it("validates arguments before execution", async () => {
    const registry = new ToolRegistry();
    const tool: BaseTool = {
      name: "t",
      description: "t",
      schema: { name: "t", description: "t" },
      validate: () => ["bad args"],
      execute: vi.fn(),
    };
    registry.register(tool);

    await expect(registry.execute("t", {})).rejects.toThrow(
      "Invalid arguments for t: bad args",
    );
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("returns error string when tool throws", async () => {
    const registry = new ToolRegistry();
    const tool: BaseTool = {
      name: "boom",
      description: "boom",
      schema: { name: "boom", description: "boom" },
      execute: vi.fn().mockRejectedValue(new Error("kaboom")),
      validate: () => [],
    };
    registry.register(tool);

    await expect(registry.execute("boom", {})).rejects.toThrow(
      "Tool boom failed: kaboom",
    );
  });

  it("registers tools and exposes lookups", () => {
    const registry = new ToolRegistry();
    const tool: BaseTool = {
      name: "alpha",
      description: "alpha",
      schema: { name: "alpha", description: "alpha" },
      execute: vi.fn(),
      validate: () => [],
    };

    registry.register(tool);

    expect(registry.get("alpha")).toBe(tool);
    expect(registry.has("alpha")).toBe(true);
  });
});
