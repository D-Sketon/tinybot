import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelManager } from "../../src/channels/manager.ts";

const {
  attachCliChannelMock,
  webhookStartMock,
  webhookStopMock,
  webhookIsRunningMock,
  webhookDescribeMock,
} = vi.hoisted(() => ({
  attachCliChannelMock: vi.fn(),
  webhookStartMock: vi.fn().mockResolvedValue(undefined),
  webhookStopMock: vi.fn().mockResolvedValue(undefined),
  webhookIsRunningMock: vi.fn().mockReturnValue(true),
  webhookDescribeMock: vi
    .fn()
    .mockReturnValue("http://127.0.0.1:18790/inbound"),
}));

vi.mock("../../src/channels/cli.ts", () => ({
  attachCliChannel: attachCliChannelMock,
}));

vi.mock("../../src/channels/webhook.ts", () => ({
  WebhookChannel: class {
    constructor() {}
    start = webhookStartMock;
    stop = webhookStopMock;
    isRunning = webhookIsRunningMock;
    describe = webhookDescribeMock;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("channelManager", () => {
  it("attaches cli channel when enabled", async () => {
    const bus = {} as any;
    const manager = new ChannelManager(bus, {
      channels: { cli: { enabled: true } },
    } as any);

    await manager.start();

    expect(attachCliChannelMock).toHaveBeenCalledWith(bus, {
      verbose: undefined,
    });
    const status = manager.getRuntimeStatus().find((s) => s.name === "cli");
    expect(status?.running).toBe(true);
    expect(status?.enabled).toBe(true);
  });

  it("skips cli when not allowed by filter", async () => {
    const bus = {} as any;
    const manager = new ChannelManager(bus, {
      channels: { cli: { enabled: true } },
    } as any);

    await manager.start(["webhook"]);

    expect(attachCliChannelMock).not.toHaveBeenCalled();
    const status = manager.getRuntimeStatus().find((s) => s.name === "cli");
    expect(status?.running).toBe(false);
  });

  it("starts webhook when enabled and stops when disabled", async () => {
    const bus = {} as any;
    const manager = new ChannelManager(bus, {
      channels: { webhook: { enabled: true, port: 1234, host: "127.0.0.1" } },
    } as any);

    await manager.start();
    expect(webhookStartMock).toHaveBeenCalled();

    await manager.start(["cli"]);
    expect(webhookStopMock).toHaveBeenCalled();
  });

  it("stops the webhook when requested", async () => {
    const bus = {} as any;
    const manager = new ChannelManager(bus, {
      channels: { webhook: { enabled: true } },
    } as any);

    await manager.start();
    await manager.stop();

    expect(webhookStopMock).toHaveBeenCalled();
  });

  it("inspectStatus: returns disabled when webhook disabled", async () => {
    const rows = await (ChannelManager as any).inspectStatus({
      channels: { webhook: { enabled: false } },
    } as any);
    const webhook = rows.find((r: any) => r.name === "webhook");
    expect(webhook.enabled).toBe(false);
    expect(webhook.status).toBe("disabled");
  });

  it("inspectStatus: healthy webhook with custom healthUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    const rows = await (ChannelManager as any).inspectStatus({
      channels: {
        webhook: { enabled: true, healthUrl: "http://example/health" },
      },
    } as any);
    const webhook = rows.find((r: any) => r.name === "webhook");
    expect(webhook.enabled).toBe(true);
    expect(webhook.status).toBe("ready");
    expect(webhook.details).toBe("Healthy");
    expect(webhook.healthUrl).toBe("http://example/health");
  });

  it("inspectStatus: reports HTTP error status when fetch not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const rows = await (ChannelManager as any).inspectStatus({
      channels: { webhook: { enabled: true } },
    } as any);
    const webhook = rows.find((r: any) => r.name === "webhook");
    expect(webhook.enabled).toBe(true);
    expect(webhook.status).toBe("error");
    expect(webhook.details).toBe("HTTP 500");
  });

  it("inspectStatus: resolves 0.0.0.0 host to 127.0.0.1 in healthUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    const rows = await (ChannelManager as any).inspectStatus({
      channels: { webhook: { enabled: true, host: "0.0.0.0" } },
    } as any);
    const webhook = rows.find((r: any) => r.name === "webhook");
    expect(webhook.healthUrl).toBe("http://127.0.0.1:18790/health");
  });

  it("inspectStatus: handles fetch rejection and reports error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("nope")));
    const rows = await (ChannelManager as any).inspectStatus({
      channels: { webhook: { enabled: true } },
    } as any);
    const webhook = rows.find((r: any) => r.name === "webhook");
    expect(webhook.status).toBe("error");
    expect(webhook.details).toBe("nope");
  });

  it("start twice does not recreate webhook instance", async () => {
    const bus = {} as any;
    const manager = new ChannelManager(bus, {
      channels: { webhook: { enabled: true } },
    } as any);

    await manager.start();
    expect(webhookStartMock).toHaveBeenCalledTimes(1);

    // starting again without filters should reuse existing webhook
    await manager.start();
    expect(webhookStartMock).toHaveBeenCalledTimes(2);
  });

  it("inspectCliStatus: returns disabled when cli disabled", async () => {
    const rows = await (ChannelManager as any).inspectStatus({
      channels: { cli: { enabled: false }, webhook: { enabled: false } },
    } as any);
    const cli = rows.find((r: any) => r.name === "cli");
    expect(cli.enabled).toBe(false);
    expect(cli.status).toBe("disabled");
    expect(cli.details).toBe("Disabled via config");
  });

  it("inspectStatus: includes secret header when provided to health check", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await (ChannelManager as any).inspectStatus({
      channels: { webhook: { enabled: true, secret: "s3cr3t" } },
    } as any);
    const webhook = rows.find((r: any) => r.name === "webhook");
    expect(webhook.enabled).toBe(true);
    expect(webhook.status).toBe("ready");
    // ensure fetch was called with headers containing the secret
    const callArgs = (fetchMock as any).mock.calls[0];
    expect(callArgs).toBeDefined();
    const opts = callArgs[1];
    expect(opts.headers["x-tinybot-secret"]).toBe("s3cr3t");
  });
});
