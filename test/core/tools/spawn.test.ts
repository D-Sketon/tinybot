import { describe, expect, it, vi } from "vitest";

import { SpawnTool } from "../../../src/core/tools/spawn.ts";

describe("spawnTool", () => {
  it("spawns subagent with defaults", async () => {
    const spawn = vi.fn().mockResolvedValue("spawned");
    const subagents = { spawn };
    const tool = new SpawnTool(subagents as any);

    const result = await tool.execute({ task: "do work" });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "do work",
        originChannel: "cli",
        originChatId: "direct",
      }),
    );
    expect(result).toBe("spawned");
  });

  it("spawns subagent with overrides", async () => {
    const spawn = vi.fn().mockResolvedValue("ok");
    const subagents = { spawn };
    const tool = new SpawnTool(subagents as any);

    const result = await tool.execute({
      task: "task",
      label: "label",
      channel: "webhook",
      chatId: "room",
    });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "task",
        label: "label",
        originChannel: "webhook",
        originChatId: "room",
      }),
    );
    expect(result).toBe("ok");
  });

  it("rejects missing task", async () => {
    const spawn = vi.fn();
    const tool = new SpawnTool({ spawn } as any);

    await expect(tool.execute({})).rejects.toThrow("task must be provided");
  });

  it("validates task and optional fields", () => {
    const tool = new SpawnTool({ spawn: vi.fn() } as any);
    const errors = tool.validate({
      task: " ",
      label: 1 as any,
      channel: false as any,
      chatId: {} as any,
    });

    expect(errors).toContain("Value at 'label' should be string");
    expect(errors).toContain("Value at 'channel' should be string");
    expect(errors).toContain("Value at 'chatId' should be string");
  });
});
