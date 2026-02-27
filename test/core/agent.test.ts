import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TinybotAgent } from "../../src/core/agent.ts";

const {
  createProviderMock,
  getOrCreateMock,
  saveMock,
  consolaLogMock,
  consolaWarnMock,
  consolaErrorMock,
} = vi.hoisted(() => ({
  createProviderMock: vi.fn(),
  getOrCreateMock: vi.fn(),
  saveMock: vi.fn(),
  consolaLogMock: vi.fn(),
  consolaWarnMock: vi.fn(),
  consolaErrorMock: vi.fn(),
}));

let lastSkillsArgs: { workspace?: string; builtin?: string } | null = null;

vi.mock("../../src/core/provider.ts", () => ({
  createProvider: createProviderMock,
}));
vi.mock("../../src/core/memory.ts", () => ({
  MemoryStore: class {
    getMemoryContext() {
      return "memory";
    }
  },
}));
vi.mock("../../src/core/skills.ts", () => ({
  SkillsStore: class {
    constructor(workspace: string, builtin?: string) {
      lastSkillsArgs = { workspace, builtin };
    }
    buildSummary() {
      return "skills";
    }
  },
}));
vi.mock("../../src/core/session.ts", () => ({
  SessionManager: class {
    async getOrCreate(sessionKey: string) {
      return getOrCreateMock(sessionKey);
    }
    async save(session: any) {
      return saveMock(session);
    }
  },
}));
vi.mock("consola", () => ({
  consola: {
    log: consolaLogMock,
    warn: consolaWarnMock,
    error: consolaErrorMock,
  },
}));

interface Inbound {
  channel: string;
  chatId: string;
  senderId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

const createSession = (id: string) => ({
  id,
  messages: [],
  metadata: {},
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

describe("tinybotAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSkillsArgs = null;
  });

  it("processes inbound messages and publishes replies", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ content: "hello back" }),
    };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockResolvedValue(createSession("cli:direct"));

    const bus = { publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    const inbound: Inbound = {
      channel: "cli",
      chatId: "direct",
      senderId: "user",
      content: "hello",
      metadata: { replyTo: "msg-1" },
    };

    await (agent as any).handleInbound(inbound);

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(bus.publishOutbound).toHaveBeenCalledWith({
      channel: "cli",
      chatId: "direct",
      content: "hello back",
      replyTo: "msg-1",
    });
  });

  it("publishes streaming deltas before final response", async () => {
    const provider = {
      generate: vi.fn(),
      generateStream: vi
        .fn()
        .mockImplementation(async (_messages, _tools, onDelta) => {
          await onDelta?.("he");
          await onDelta?.("llo");
          return { content: "hello" };
        }),
    };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockResolvedValue(createSession("cli:direct"));

    const bus = { publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    await (agent as any).handleInbound({
      channel: "cli",
      chatId: "direct",
      senderId: "user",
      content: "stream",
    });

    const calls = bus.publishOutbound.mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual(
      expect.objectContaining({ kind: "delta", content: "he", sequence: 1 }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({ kind: "delta", content: "llo", sequence: 2 }),
    );
    expect(calls[calls.length - 1]).toEqual(
      expect.objectContaining({ kind: "final", content: "hello" }),
    );
  });

  it("executes tool calls and continues to final response", async () => {
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: "calling tool",
          toolCalls: [{ id: "1", name: "unknown_tool", arguments: {} }],
        })
        .mockResolvedValueOnce({ content: "done" }),
    };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockResolvedValue(createSession("cli:direct"));

    const bus = { publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    const inbound: Inbound = {
      channel: "cli",
      chatId: "direct",
      senderId: "user",
      content: "do stuff",
    };

    await (agent as any).handleInbound(inbound);

    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(bus.publishOutbound).toHaveBeenCalledWith({
      channel: "cli",
      chatId: "direct",
      content: "done",
      replyTo: undefined,
    });

    const saved = saveMock.mock.calls[0]?.[0];
    const toolMessage = saved?.messages?.find((m: any) => m.role === "tool");
    expect(toolMessage?.name).toBe("unknown_tool");
  });

  it("routes messages to another session via sessions_send", async () => {
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: "delegating",
          toolCalls: [
            {
              id: "1",
              name: "sessions_send",
              arguments: {
                to: "cli:worker",
                content: "please handle this task",
              },
            },
          ],
        })
        .mockResolvedValueOnce({ content: "delegated" }),
    };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockResolvedValue(createSession("cli:direct"));

    const bus = { publishOutbound: vi.fn(), publishInbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    await (agent as any).handleInbound({
      channel: "cli",
      chatId: "direct",
      senderId: "user",
      content: "delegate",
    });

    expect(bus.publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "cli",
        chatId: "worker",
        content: "please handle this task",
      }),
    );
    expect(bus.publishOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "delegated",
      }),
    );
  });

  it("forwards reply to origin session when replyBackTo is present", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ content: "worker result" }),
    };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockResolvedValue(createSession("cli:worker"));

    const bus = { publishOutbound: vi.fn(), publishInbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    await (agent as any).handleInbound({
      channel: "cli",
      chatId: "worker",
      senderId: "agent",
      content: "do work",
      metadata: {
        replyBackTo: { channel: "cli", chatId: "coordinator" },
      },
    });

    expect(bus.publishOutbound).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channel: "cli",
        chatId: "worker",
        content: "worker result",
      }),
    );
    expect(bus.publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "cli",
        chatId: "coordinator",
        senderId: "system",
        content: expect.stringContaining("worker result"),
      }),
    );
  });

  it("emits a max-iteration message when tool calls never finish", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({
        content: "loop",
        toolCalls: [{ id: "1", name: "unknown_tool", arguments: {} }],
      }),
    };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockResolvedValue(createSession("cli:direct"));

    const bus = { publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
      maxToolIterations: 2,
    });

    const inbound: Inbound = {
      channel: "cli",
      chatId: "direct",
      senderId: "user",
      content: "do stuff",
    };

    await (agent as any).handleInbound(inbound);

    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(bus.publishOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Max iterations reached without a final response.",
      }),
    );
  });

  it("reports provider errors back to the user", async () => {
    const provider = {
      generate: vi.fn().mockRejectedValue(new Error("provider down")),
    };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockResolvedValue(createSession("cli:direct"));

    const bus = { publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    const inbound: Inbound = {
      channel: "cli",
      chatId: "direct",
      senderId: "user",
      content: "ping",
    };

    await (agent as any).handleInbound(inbound);

    expect(bus.publishOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Provider error: provider down",
      }),
    );
  });

  it("enqueues inbound messages with defaults", async () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    const bus = { publishInbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    await agent.enqueueMessage("hello");

    expect(bus.publishInbound).toHaveBeenCalledWith({
      channel: "cli",
      senderId: "user",
      chatId: "direct",
      content: "hello",
      metadata: undefined,
    });

    // also verify explicit parameters path
    await agent.enqueueMessage("hello", {
      channel: "cli",
      chatId: "direct",
      senderId: "me",
    });
    expect(bus.publishInbound).toHaveBeenCalledWith({
      channel: "cli",
      senderId: "me",
      chatId: "direct",
      content: "hello",
      metadata: undefined,
    });
  });

  it("skips cron jobs without message payload", async () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    const bus = { publishInbound: vi.fn(), publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    await (agent as any).handleCronJob({ id: "job-1", payload: {} });

    expect(bus.publishInbound).not.toHaveBeenCalled();
  });

  it("starts and stops services without double-starting", async () => {
    const provider = { generate: vi.fn().mockResolvedValue({ content: "ok" }) };
    createProviderMock.mockReturnValue(provider);

    const bus = {
      publishOutbound: vi.fn(),
      dispatchOutbound: vi.fn(),
      stopDispatch: vi.fn(),
    };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    (agent as any).runLoop = vi.fn();
    await agent.start();
    await agent.start();

    expect(bus.dispatchOutbound).toHaveBeenCalledTimes(1);
    expect(consolaLogMock).toHaveBeenCalledWith(
      "tinybot agent starting with workspace",
      (agent as any).context.workspacePath,
    );

    agent.stop();
    expect(bus.stopDispatch).toHaveBeenCalledTimes(1);
    expect(consolaLogMock).toHaveBeenCalledWith("tinybot agent has stopped");
  });

  it("does not stop when not running", () => {
    const provider = { generate: vi.fn().mockResolvedValue({ content: "ok" }) };
    createProviderMock.mockReturnValue(provider);
    const bus = { stopDispatch: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    agent.stop();

    expect(bus.stopDispatch).not.toHaveBeenCalled();
  });

  it("resolves builtin skills path", () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    const previousBuiltin = process.env.TINYBOT_BUILTIN_SKILLS;
    process.env.TINYBOT_BUILTIN_SKILLS = "C:\\skills";

    const agentWithToolKey = new TinybotAgent({} as any, {
      tools: { web: { maxResults: 2 } },
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    expect((agentWithToolKey as any).resolveBuiltinSkillsPath()).toContain(
      "C:\\skills",
    );
    expect(lastSkillsArgs?.builtin).toContain("C:\\skills");

    process.env.TINYBOT_BUILTIN_SKILLS = previousBuiltin;
  });

  it("initializes automation services when enabled", () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);

    const agent = new TinybotAgent({} as any, {
      cron: { enabled: true },
      heartbeat: { enabled: true, intervalSeconds: 5 },
    });

    expect((agent as any).cronService).toBeDefined();
    expect((agent as any).cronTool).toBeDefined();
    expect((agent as any).heartbeatService).toBeDefined();
  });

  it("handles cron jobs with defaults and publishes system messages", async () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    const bus = { publishInbound: vi.fn(), publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    await (agent as any).handleCronJob({
      id: "job-2",
      payload: { message: "ping" },
    });

    expect(bus.publishInbound).toHaveBeenCalledWith({
      channel: "cron",
      chatId: "cron",
      senderId: "system",
      content: "ping",
      metadata: {
        origin: "cron",
        cronJobId: "job-2",
        deliver: false,
        payloadKind: "agent_turn",
      },
    });
  });

  it("handleInbound reports unexpected errors from session retrieval", async () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    getOrCreateMock.mockRejectedValueOnce(new Error("session fail"));

    const bus = { publishOutbound: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    const inbound: Inbound = {
      channel: "cli",
      chatId: "direct",
      senderId: "user",
      content: "hello",
    };

    await (agent as any).handleInbound(inbound);

    expect(bus.publishOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Sorry, I encountered an error"),
      }),
    );
  });

  it("heartbeat onHeartbeat triggers publishSystemInbound", async () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    const bus = { publishInbound: vi.fn() };

    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: true, intervalSeconds: 1 },
    });

    // call the heartbeat callback directly
    const hb = (agent as any).heartbeatService as any;
    await hb.onHeartbeat?.("HB_PROMPT");

    expect(bus.publishInbound).toHaveBeenCalledWith({
      channel: "heartbeat",
      chatId: "heartbeat",
      senderId: "system",
      content: "HB_PROMPT",
      metadata: { origin: "heartbeat" },
    });
  });

  it("resolveBuiltinSkillsPath returns default when env not set", () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    const previous = process.env.TINYBOT_BUILTIN_SKILLS;
    delete process.env.TINYBOT_BUILTIN_SKILLS;

    const agent = new TinybotAgent({} as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    const p = (agent as any).resolveBuiltinSkillsPath();
    expect(p).toContain(path.join("workspace", "skills"));

    if (previous !== undefined) process.env.TINYBOT_BUILTIN_SKILLS = previous;
  });

  it("stop calls cronService.stop and heartbeatService.stop when running", () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    const bus = { stopDispatch: vi.fn() };
    const agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    (agent as any).running = true;
    const cs = { stop: vi.fn() };
    const hs = { stop: vi.fn() };
    (agent as any).cronService = cs;
    (agent as any).heartbeatService = hs;

    agent.stop();

    expect(cs.stop).toHaveBeenCalled();
    expect(hs.stop).toHaveBeenCalled();
    expect(bus.stopDispatch).toHaveBeenCalled();
  });

  it("runLoop exits when inbound is null and logs errors", async () => {
    const provider = { generate: vi.fn() };
    createProviderMock.mockReturnValue(provider);
    let agent: TinybotAgent;
    const bus = {
      consumeInbound: vi
        .fn()
        .mockImplementationOnce(() => {
          (agent as any).running = false;
          return Promise.resolve(null);
        })
        .mockImplementationOnce(() => {
          (agent as any).running = false;
          throw new Error("boom");
        }),
    };
    agent = new TinybotAgent(bus as any, {
      cron: { enabled: false },
      heartbeat: { enabled: false },
    });

    (agent as any).running = true;
    await (agent as any).runLoop();

    (agent as any).running = true;
    await (agent as any).runLoop();

    expect(consolaWarnMock).toHaveBeenCalledWith("agent loop error", "boom");
  });
});
