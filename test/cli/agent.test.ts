import type { SessionTarget } from "../../src/cli/agent.ts";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveSessionTarget,
  runAgent,
  waitForResponse,
} from "../../src/cli/agent.ts";

const {
  consolaLogMock,
  consolaWarnMock,
  attachCliChannelMock,
  loadConfigMock,
  MessageBusMock,
  TinybotAgentMock,
  readlineCreateInterfaceMock,
} = vi.hoisted(() => ({
  consolaLogMock: vi.fn(),
  consolaWarnMock: vi.fn(),
  attachCliChannelMock: vi.fn(),
  loadConfigMock: vi.fn(),
  MessageBusMock: vi.fn(),
  TinybotAgentMock: vi.fn(),
  readlineCreateInterfaceMock: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { log: consolaLogMock, warn: consolaWarnMock },
}));
vi.mock("../../src/channels/cli.ts", () => ({
  attachCliChannel: attachCliChannelMock,
}));
vi.mock("../../src/config/loader.ts", () => ({ loadConfig: loadConfigMock }));
vi.mock("../../src/core/bus.ts", () => ({ MessageBus: MessageBusMock }));
vi.mock("../../src/core/agent.ts", () => ({ TinybotAgent: TinybotAgentMock }));
vi.mock("node:readline/promises", () => ({
  createInterface: readlineCreateInterfaceMock,
  default: {
    createInterface: readlineCreateInterfaceMock,
  },
}));

type AgentOptions = Parameters<typeof runAgent>[0];

interface BusInstance {
  subscribeOutbound: ReturnType<typeof vi.fn>;
  unsubscribeOutbound: ReturnType<typeof vi.fn>;
}

interface AgentInstance {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  enqueueMessage: ReturnType<typeof vi.fn>;
  bus: BusInstance;
}

const createBusInstance = (): BusInstance => ({
  subscribeOutbound: vi.fn(),
  unsubscribeOutbound: vi.fn(),
});

const createAgentInstance = (bus: BusInstance): AgentInstance => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  enqueueMessage: vi.fn().mockResolvedValue(undefined),
  bus,
});

let lastBusInstance: BusInstance;
let lastAgentInstance: AgentInstance;

const createOptions = (
  overrides: Partial<AgentOptions> = {},
): AgentOptions => ({
  config: undefined,
  message: undefined,
  session: "default",
  interactive: false,
  verbose: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line prefer-arrow-callback
  MessageBusMock.mockImplementation(function () {
    lastBusInstance = createBusInstance();
    return lastBusInstance;
  });
  // eslint-disable-next-line prefer-arrow-callback
  TinybotAgentMock.mockImplementation(function (bus: BusInstance) {
    lastAgentInstance = createAgentInstance(bus);
    return lastAgentInstance;
  });
});

describe("runAgent", () => {
  it("starts the agent and enqueues a message when provided", async () => {
    const config = { channels: { cli: { verbose: true } } };
    loadConfigMock.mockResolvedValue(config);

    // eslint-disable-next-line prefer-arrow-callback
    MessageBusMock.mockImplementationOnce(function () {
      const bus = createBusInstance();
      bus.subscribeOutbound.mockImplementation(
        (_channel: string, handler: (msg: { chatId: string }) => void) => {
          queueMicrotask(() => handler({ chatId: "room-7" }));
          return undefined;
        },
      );
      lastBusInstance = bus;
      return bus;
    });

    const options = createOptions({
      config: "tinybot.json",
      message: "ping",
      session: "discord:room-7",
    });

    await runAgent(options);

    expect(loadConfigMock).toHaveBeenCalledWith("tinybot.json");
    expect(MessageBusMock).toHaveBeenCalledTimes(1);
    expect(attachCliChannelMock).toHaveBeenCalledWith(lastBusInstance, {
      verbose: true,
    });
    expect(TinybotAgentMock).toHaveBeenCalledWith(lastBusInstance, config);
    expect(lastAgentInstance.start).toHaveBeenCalled();
    expect(lastAgentInstance.enqueueMessage).toHaveBeenCalledWith("ping", {
      channel: "discord",
      chatId: "room-7",
    });
    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("Queued message"),
    );
  });

  it("logs guidance when no message is provided", async () => {
    loadConfigMock.mockResolvedValue({});

    const options = createOptions({ session: "solo" });

    await runAgent(options);

    expect(lastAgentInstance.enqueueMessage).not.toHaveBeenCalled();
    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("tinybot agent ready"),
    );
  });
});

describe("resolveSessionTarget", () => {
  it("defaults to the CLI channel when no delimiter is present", () => {
    expect(resolveSessionTarget("user")).toEqual({
      channel: "cli",
      chatId: "user",
    });
  });

  it("falls back to the default chat when no id is provided", () => {
    expect(resolveSessionTarget("")).toEqual({
      channel: "cli",
      chatId: "default",
    });
  });

  it("splits channel and chat identifiers when provided", () => {
    expect(resolveSessionTarget("telegram:chat-42")).toEqual({
      channel: "telegram",
      chatId: "chat-42",
    });
  });
});

describe("waitForResponse", () => {
  it("resolves only after receiving a matching outbound message", async () => {
    let outboundHandler:
      | ((msg: { chatId: string; kind?: string }) => void)
      | undefined;

    const bus = {
      subscribeOutbound: vi.fn(
        (channel: string, handler: (msg: { chatId: string }) => void) => {
          outboundHandler = handler;
          return undefined;
        },
      ),
      unsubscribeOutbound: vi.fn(),
    };

    const agent = {
      bus,
      enqueueMessage: vi.fn().mockResolvedValue(undefined),
    };

    const target: SessionTarget = { channel: "cli", chatId: "user-42" };

    const waitPromise = waitForResponse(agent as any, target, "hello");

    expect(bus.subscribeOutbound).toHaveBeenCalledWith(
      "cli",
      expect.any(Function),
    );
    expect(agent.enqueueMessage).toHaveBeenCalledWith("hello", target);
    expect(outboundHandler).toBeDefined();

    outboundHandler?.({ chatId: "someone-else" });
    await Promise.resolve();
    expect(bus.unsubscribeOutbound).not.toHaveBeenCalled();

    outboundHandler?.({ chatId: "user-42", kind: "delta" });
    await Promise.resolve();
    expect(bus.unsubscribeOutbound).not.toHaveBeenCalled();

    outboundHandler?.({ chatId: "user-42", kind: "final" });
    await waitPromise;

    expect(bus.unsubscribeOutbound).toHaveBeenCalledWith(
      "cli",
      outboundHandler,
    );
  });

  it("times out when no response arrives", async () => {
    const bus = {
      subscribeOutbound: vi.fn((_ch, _h) => undefined),
      unsubscribeOutbound: vi.fn(),
    };

    const agent = {
      bus,
      enqueueMessage: vi.fn().mockResolvedValue(undefined),
    };

    const target: SessionTarget = { channel: "cli", chatId: "no-one" };

    const p = waitForResponse(agent as any, target, "hello", 10);
    await expect(p).rejects.toThrow(/Timed out waiting for response/);
    expect(bus.unsubscribeOutbound).toHaveBeenCalled();
  });

  it("propagates enqueueMessage rejection and unsubscribes", async () => {
    const bus = {
      subscribeOutbound: vi.fn((_ch, _h) => undefined),
      unsubscribeOutbound: vi.fn(),
    };

    const agent = {
      bus,
      enqueueMessage: vi.fn().mockRejectedValue(new Error("enqueue failed")),
    };

    const target: SessionTarget = { channel: "cli", chatId: "x" };

    await expect(
      waitForResponse(agent as any, target, "hi", 50),
    ).rejects.toThrow("enqueue failed");
    expect(bus.unsubscribeOutbound).toHaveBeenCalled();
  });

  it("runAgent interactive mode delegates to readline loop and exits", async () => {
    loadConfigMock.mockResolvedValue({ channels: {} });

    const rl = {
      question: vi.fn().mockResolvedValue("/exit"),
      close: vi.fn(),
      on: vi.fn(),
    };
    readlineCreateInterfaceMock.mockReturnValue(rl as any);

    const options = createOptions({ interactive: true });

    await runAgent(options);

    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("tinybot interactive mode"),
    );
    expect(lastAgentInstance.start).toHaveBeenCalled();
    expect(lastAgentInstance.stop).toHaveBeenCalled();
  });

  it("runAgent interactive ignores empty input then quits on /quit", async () => {
    loadConfigMock.mockResolvedValue({ channels: {} });

    const rl = {
      question: vi
        .fn()
        .mockResolvedValueOnce("   ")
        .mockResolvedValueOnce("/quit"),
      close: vi.fn(),
      on: vi.fn(),
    };
    readlineCreateInterfaceMock.mockReturnValue(rl as any);

    const options = createOptions({ interactive: true });

    await runAgent(options);

    expect(rl.question).toHaveBeenCalledTimes(2);
    expect(lastAgentInstance.stop).toHaveBeenCalled();
  });

  it("runAgent interactive logs warning when waitForResponse fails", async () => {
    loadConfigMock.mockResolvedValue({ channels: {} });

    // Prepare readline to return a message then exit
    const rl = {
      question: vi
        .fn()
        .mockResolvedValueOnce("hello")
        .mockResolvedValueOnce("/exit"),
      close: vi.fn(),
      on: vi.fn(),
    };
    readlineCreateInterfaceMock.mockReturnValue(rl as any);

    // Make the TinybotAgent instance used by runAgent reject when enqueueMessage is called
    // eslint-disable-next-line prefer-arrow-callback
    TinybotAgentMock.mockImplementationOnce(function (bus: any) {
      lastAgentInstance = createAgentInstance(bus as any);
      lastAgentInstance.enqueueMessage = vi
        .fn()
        .mockRejectedValue(new Error("send-failed"));
      return lastAgentInstance as any;
    });

    const options = createOptions({ interactive: true });

    await runAgent(options);

    expect(consolaWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to get response"),
    );
  });

  it("runAgent logs a warning when waitForResponse times out", async () => {
    loadConfigMock.mockResolvedValue({});

    // Make the agent's enqueueMessage reject to trigger the catch path in runAgent
    // eslint-disable-next-line prefer-arrow-callback
    TinybotAgentMock.mockImplementation(function (bus: any) {
      lastAgentInstance = createAgentInstance(bus);
      lastAgentInstance.enqueueMessage = vi
        .fn()
        .mockRejectedValue(new Error("boom"));
      return lastAgentInstance;
    });

    const options = createOptions({ message: "ping" });
    await runAgent(options);

    expect(consolaWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("No response received"),
    );
  });
});
