import { beforeEach, describe, expect, it, vi } from "vitest";

import { runStatusCommand } from "../../src/cli/status.ts";

const { loadConfigMock, inspectStatusMock, consolaLogMock } = vi.hoisted(
  () => ({
    loadConfigMock: vi.fn(),
    inspectStatusMock: vi.fn(),
    consolaLogMock: vi.fn(),
  }),
);

vi.mock("../../src/config/loader.ts", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../../src/channels/manager.ts", () => ({
  ChannelManager: {
    inspectStatus: inspectStatusMock,
  },
}));

vi.mock("consola", () => ({
  consola: {
    log: consolaLogMock,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("status command", () => {
  it("prints human-readable summary with channel health", async () => {
    loadConfigMock.mockResolvedValue({
      workspace: "./workspace",
      provider: { type: "openai", model: "gpt-4.1" },
      channels: {
        cli: { enabled: true },
        webhook: { enabled: true },
      },
      providers: {
        openai: { apiKey: "secret" },
      },
    });
    inspectStatusMock.mockResolvedValue([
      { name: "cli", enabled: true, status: "ready", details: "Healthy" },
      {
        name: "webhook",
        enabled: true,
        status: "error",
        details: "HTTP 500",
        healthUrl: "http://127.0.0.1:18790/health",
      },
    ]);

    await runStatusCommand({ config: "tinybot.config.json" });

    expect(loadConfigMock).toHaveBeenCalledWith("tinybot.config.json");
    expect(inspectStatusMock).toHaveBeenCalledTimes(1);
    expect(consolaLogMock).toHaveBeenCalledWith("Channel Health:");
    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("Channel"),
    );
    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("webhook"),
    );
  });

  it("prints JSON output when json option is enabled", async () => {
    loadConfigMock.mockResolvedValue({
      workspace: "./workspace",
      model: "gpt-4.1-mini",
      channels: {
        cli: { enabled: true },
      },
      providers: {},
    });
    inspectStatusMock.mockResolvedValue([
      { name: "cli", enabled: true, status: "ready", details: "Healthy" },
      {
        name: "webhook",
        enabled: false,
        status: "disabled",
        details: "Disabled via config",
      },
    ]);

    await runStatusCommand({ json: true });

    expect(consolaLogMock).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consolaLogMock.mock.calls[0][0]);
    expect(output.channelStatus).toHaveLength(2);
    expect(output.channelStatus[0].name).toBe("cli");
    expect(output.channelStatus[1].status).toBe("disabled");
  });
});
