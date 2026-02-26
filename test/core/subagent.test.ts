import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubagentManager } from "../../src/core/subagent.ts";

const { consolaWarnMock } = vi.hoisted(() => ({
  consolaWarnMock: vi.fn(),
}));

vi.mock("consola", () => ({ consola: { warn: consolaWarnMock } }));

describe("subagentManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns a task and publishes the result", async () => {
    let resolvePublish: (payload: any) => void;
    const publishPromise = new Promise((resolve) => {
      resolvePublish = resolve;
    });

    const provider = {
      generate: vi.fn().mockResolvedValue({ content: "done" }),
    };
    const bus = {
      publishInbound: vi.fn(async (payload: any) => {
        resolvePublish(payload);
      }),
    };

    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
    });

    const message = await manager.spawn({
      task: "Summarize this task please",
      originChannel: "slack",
      originChatId: "room-1",
    });

    expect(message).toContain("Subagent 'Summarize this task please' started");

    const payload = (await publishPromise) as any;
    expect(payload.channel).toBe("slack");
    expect(payload.chatId).toBe("room-1");
    expect(payload.metadata.status).toBe("ok");
    expect(payload.content).toContain("Result:\ndone");
  });

  it("derives a short label for long tasks", async () => {
    let resolvePublish: (payload: any) => void;
    const publishPromise = new Promise((resolve) => {
      resolvePublish = resolve;
    });

    const provider = {
      generate: vi.fn().mockResolvedValue({ content: "ok" }),
    };
    const bus = {
      publishInbound: vi.fn(async (payload: any) => {
        resolvePublish(payload);
      }),
    };

    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
    });

    const longTask =
      "This is a very long task that should be shortened in the label.";
    const message = await manager.spawn({ task: longTask });

    expect(message).toContain(
      "Subagent 'This is a very long task that should ...' started",
    );
    await publishPromise;
  });

  it("reports provider errors as failures", async () => {
    let resolvePublish: (payload: any) => void;
    const publishPromise = new Promise((resolve) => {
      resolvePublish = resolve;
    });

    const provider = {
      generate: vi.fn().mockRejectedValue(new Error("provider down")),
    };
    const bus = {
      publishInbound: vi.fn(async (payload: any) => {
        resolvePublish(payload);
      }),
    };

    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
    });

    await manager.spawn({ task: "do thing" });

    const payload = (await publishPromise) as any;
    expect(payload.metadata.status).toBe("error");
    expect(payload.content).toContain("Provider error: provider down");
  });

  it("marks tool failures as error status", async () => {
    let resolvePublish: (payload: any) => void;
    const publishPromise = new Promise((resolve) => {
      resolvePublish = resolve;
    });

    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: "calling tool",
          toolCalls: [{ id: "1", name: "missing_tool", arguments: {} }],
        })
        .mockResolvedValueOnce({ content: "done" }),
    };
    const bus = {
      publishInbound: vi.fn(async (payload: any) => {
        resolvePublish(payload);
      }),
    };

    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
    });

    await manager.spawn({ task: "use tool" });

    const payload = (await publishPromise) as any;
    expect(payload.metadata.status).toBe("error");
    expect(payload.content).toContain("Result:\ndone");
  });

  it("throws when task is missing", async () => {
    const provider = { generate: vi.fn() };
    const bus = { publishInbound: vi.fn() };
    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
    });

    await expect(manager.spawn({ task: "" })).rejects.toThrow(
      "task is required",
    );
  });

  it("tracks running subagents", async () => {
    let resolveGenerate: (value: any) => void;
    const generatePromise = new Promise((resolve) => {
      resolveGenerate = resolve;
    });
    const provider = {
      generate: vi.fn().mockReturnValue(generatePromise),
    };
    const bus = { publishInbound: vi.fn() };
    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
    });

    const spawnPromise = manager.spawn({ task: "long task" });
    expect((manager as any).running.size).toBe(1);

    resolveGenerate!({ content: "done" });
    await spawnPromise;
  });

  it("logs when the runner throws", async () => {
    const provider = { generate: vi.fn() };
    const bus = { publishInbound: vi.fn() };
    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
    });

    (manager as any).runTask = vi.fn().mockRejectedValue(new Error("boom"));
    await manager.spawn({ task: "explode" });

    expect(consolaWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Subagent"),
    );
  });

  it("uses fallback content when no final response is produced", async () => {
    let resolvePublish: (payload: any) => void;
    const publishPromise = new Promise((resolve) => {
      resolvePublish = resolve;
    });

    const provider = {
      generate: vi.fn().mockResolvedValue({
        content: "call tool",
        toolCalls: [{ id: "1", name: "missing_tool", arguments: {} }],
      }),
    };
    const bus = {
      publishInbound: vi.fn(async (payload: any) => {
        resolvePublish(payload);
      }),
    };

    const manager = new SubagentManager({
      provider: provider as any,
      workspace: "/workspace",
      bus: bus as any,
      execOptions: {},
      maxIterations: 1,
    });

    await manager.spawn({ task: "tool loop" });
    const payload = (await publishPromise) as any;

    expect(payload.content).toContain(
      "Max iterations reached without a final response.",
    );
  });
});
