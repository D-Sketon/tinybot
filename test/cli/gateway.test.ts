import { beforeEach, describe, expect, it, vi } from "vitest";

import { runGateway } from "../../src/cli/gateway.ts";

const {
  loadConfigMock,
  MessageBusMock,
  TinybotAgentMock,
  ChannelManagerMock,
  consolaLogMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  MessageBusMock: vi.fn(),
  TinybotAgentMock: vi.fn(),
  ChannelManagerMock: vi.fn(),
  consolaLogMock: vi.fn(),
}));

vi.mock("../../src/config/loader.ts", () => ({ loadConfig: loadConfigMock }));
vi.mock("../../src/core/bus.ts", () => ({ MessageBus: MessageBusMock }));
vi.mock("../../src/core/agent.ts", () => ({ TinybotAgent: TinybotAgentMock }));
vi.mock("../../src/channels/manager.ts", () => ({
  ChannelManager: ChannelManagerMock,
}));
vi.mock("consola", () => ({ consola: { log: consolaLogMock } }));

interface AgentInstance {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
interface ChannelsInstance {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

let lastAgent: AgentInstance;
let lastChannels: ChannelsInstance;
let lastAgentConfig: any;
let lastChannelsConfig: any;

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line prefer-arrow-callback
  MessageBusMock.mockImplementation(function () {
    return { id: "bus" };
  });
  // eslint-disable-next-line prefer-arrow-callback
  TinybotAgentMock.mockImplementation(function (_bus: any, config: any) {
    lastAgentConfig = config;
    lastAgent = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    return lastAgent;
  });
  // eslint-disable-next-line prefer-arrow-callback
  ChannelManagerMock.mockImplementation(function (_bus: any, config: any) {
    lastChannelsConfig = config;
    lastChannels = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    return lastChannels;
  });
});

describe("runGateway", () => {
  it("starts agent and channels, then shuts down", async () => {
    loadConfigMock.mockResolvedValue({});
    const onMock = vi
      .spyOn(process, "on")
      .mockImplementation((event, handler) => {
        if (event === "SIGINT") {
          handler();
        }
        return process as any;
      });
    const offMock = vi
      .spyOn(process, "off")
      .mockImplementation(() => process as any);

    await runGateway({ channels: ["webhook"], verbose: true });

    expect(loadConfigMock).toHaveBeenCalled();
    expect(lastAgent.start).toHaveBeenCalled();
    expect(lastChannels.start).toHaveBeenCalledWith(["webhook"]);
    expect(lastChannels.stop).toHaveBeenCalled();
    expect(lastAgent.stop).toHaveBeenCalled();
    expect(lastAgentConfig.channels?.cli?.verbose).toBe(true);
    expect(lastChannelsConfig.channels?.cli?.verbose).toBe(true);
    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("channels: webhook"),
    );

    onMock.mockRestore();
    offMock.mockRestore();
  });

  it("logs a generic message when no channels provided", async () => {
    loadConfigMock.mockResolvedValue({});
    const onMock = vi
      .spyOn(process, "on")
      .mockImplementation((event, handler) => {
        if (event === "SIGINT") {
          handler();
        }
        return process as any;
      });
    const offMock = vi
      .spyOn(process, "off")
      .mockImplementation(() => process as any);

    await runGateway({});

    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("tinybot gateway ready"),
    );

    onMock.mockRestore();
    offMock.mockRestore();
  });

  it("accepts channels as comma-separated string", async () => {
    loadConfigMock.mockResolvedValue({});
    const onMock = vi
      .spyOn(process, "on")
      .mockImplementation((event, handler) => {
        if (event === "SIGINT") {
          handler();
        }
        return process as any;
      });
    const offMock = vi
      .spyOn(process, "off")
      .mockImplementation(() => process as any);

    await runGateway({ channels: "a,b" });

    expect(lastChannels.start).toHaveBeenCalledWith(["a", "b"]);
    onMock.mockRestore();
    offMock.mockRestore();
  });

  it("accepts channels as whitespace-separated string", async () => {
    loadConfigMock.mockResolvedValue({});
    const onMock = vi
      .spyOn(process, "on")
      .mockImplementation((event, handler) => {
        if (event === "SIGINT") {
          handler();
        }
        return process as any;
      });
    const offMock = vi
      .spyOn(process, "off")
      .mockImplementation(() => process as any);

    await runGateway({ channels: "a b" });

    expect(lastChannels.start).toHaveBeenCalledWith(["a", "b"]);
    onMock.mockRestore();
    offMock.mockRestore();
  });
});
