import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebhookChannel } from "../../src/channels/webhook.ts";

const { serveMock, serverStopMock, consolaInfoMock } = vi.hoisted(() => ({
  serveMock: vi.fn(),
  serverStopMock: vi.fn(),
  consolaInfoMock: vi.fn(),
}));

vi.mock("consola", () => ({ consola: { info: consolaInfoMock } }));

beforeEach(() => {
  vi.clearAllMocks();
});

const readUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
): Promise<string> => {
  const decoder = new TextDecoder();
  let buffer = "";
  for (let i = 0; i < 5; i += 1) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    buffer += decoder.decode(value);
    if (buffer.includes(needle)) {
      break;
    }
  }
  return buffer;
};

describe("webhookChannel", () => {
  it("starts and describes listening address", async () => {
    (globalThis as any).Bun = {
      serve: serveMock.mockReturnValue({ stop: serverStopMock }),
    };

    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "0.0.0.0",
      port: 18080,
      waitTimeoutMs: 50,
    });

    await channel.start();

    expect(serveMock).toHaveBeenCalled();
    expect(channel.isRunning()).toBe(true);
    expect(channel.describe()).toBe("http://127.0.0.1:18080/messages");
  });

  it("does not restart when already running and clears state on stop", async () => {
    (globalThis as any).Bun = {
      serve: serveMock.mockReturnValue({ stop: serverStopMock }),
    };

    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    await channel.start();
    await channel.start();
    await channel.stop();

    expect(serveMock).toHaveBeenCalledTimes(1);
    expect(serverStopMock).toHaveBeenCalled();
    expect(channel.isRunning()).toBe(false);
    expect(channel.describe()).toBeNull();
  });

  it("responds to health checks", async () => {
    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
      secret: "s",
    });

    const req = new Request("http://localhost/health", {
      method: "GET",
      headers: { "x-tinybot-secret": "s" },
    });
    const res = await (channel as any).handleRequest(req);
    const body = await res.json();

    expect(body.status).toBe("ok");
  });

  it("streams outbound messages when stream=true", async () => {
    let outboundHandler: ((message: any) => void) | undefined;
    const bus = {
      subscribeOutbound: vi.fn(
        (_channel: string, handler: (message: any) => void) => {
          outboundHandler = handler;
          return undefined;
        },
      ),
      unsubscribeOutbound: vi.fn(),
      publishInbound: vi.fn(),
    };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const req = new Request("http://localhost/messages?stream=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "webhook",
        chatId: "room",
        senderId: "user",
        content: "ping",
      }),
    });
    const res = await (channel as any).handleRequest(req);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    await readUntil(reader!, "event: ready");

    outboundHandler?.({
      channel: "webhook",
      chatId: "room",
      content: "hi",
      kind: "delta",
      sequence: 1,
    });

    const delta = await readUntil(reader!, "event: delta");
    expect(delta).toContain("\"content\":\"hi\"");

    outboundHandler?.({
      channel: "webhook",
      chatId: "room",
      content: "done",
      kind: "final",
      sequence: 2,
    });

    const final = await readUntil(reader!, "event: final");
    expect(final).toContain("\"content\":\"done\"");
    await reader!.cancel();
    expect(bus.unsubscribeOutbound).toHaveBeenCalled();
  });

  it("returns not found for unsupported routes", async () => {
    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const req = new Request("http://localhost/unknown", { method: "GET" });
    const res = await (channel as any).handleRequest(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("not_found");
  });

  it("rejects unauthorized requests when secret is set", async () => {
    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
      secret: "shh",
    });

    const req = new Request("http://localhost/messages", { method: "POST" });
    const res = await (channel as any).handleRequest(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("unauthorized");
  });

  it("delivers replies from outbound subscription", async () => {
    let outboundHandler: ((message: any) => void) | undefined;
    const bus = {
      subscribeOutbound: vi.fn(
        (_channel: string, handler: (message: any) => void) => {
          outboundHandler = handler;
          return undefined;
        },
      ),
      publishInbound: vi.fn(),
    };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const waiter = (channel as any).waitForReply("webhook", "chat-1");
    outboundHandler?.({
      channel: "webhook",
      chatId: "chat-1",
      content: "pong",
    });

    await expect(waiter).resolves.toEqual(
      expect.objectContaining({ content: "pong" }),
    );
  });

  it("rejects invalid json payloads", async () => {
    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const req = new Request("http://localhost/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await (channel as any).handleRequest(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_json");
  });

  it("requires content field", async () => {
    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const req = new Request("http://localhost/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await (channel as any).handleRequest(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe("content_required");
  });

  it("uses queued replies before waiting", async () => {
    const bus = {
      subscribeOutbound: vi.fn(),
      publishInbound: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    (channel as any).pushReply({
      channel: "webhook",
      chatId: "webhook:default",
      content: "queued",
    });

    const req = new Request("http://localhost/messages?wait=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });

    const res = await (channel as any).handleRequest(req);
    const body = await res.json();

    expect(body.reply).toEqual(expect.objectContaining({ content: "queued" }));
  });

  it("keeps remaining waiters when multiple are queued", async () => {
    const bus = {
      subscribeOutbound: vi.fn(),
      publishInbound: vi.fn(),
    };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const first = (channel as any).waitForReply("webhook", "room");
    const second = (channel as any).waitForReply("webhook", "room");

    (channel as any).pushReply({
      channel: "webhook",
      chatId: "room",
      content: "one",
    });
    (channel as any).pushReply({
      channel: "webhook",
      chatId: "room",
      content: "two",
    });

    await expect(first).resolves.toEqual(
      expect.objectContaining({ content: "one" }),
    );
    await expect(second).resolves.toEqual(
      expect.objectContaining({ content: "two" }),
    );
  });

  it("handles inbound payloads and returns reply when available", async () => {
    const bus = {
      subscribeOutbound: vi.fn(),
      publishInbound: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const req = new Request("http://localhost/messages?wait=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });

    const responsePromise = (channel as any).handleRequest(req);
    await new Promise((resolve) => setTimeout(resolve, 0));
    (channel as any).pushReply({
      channel: "webhook",
      chatId: "webhook:default",
      content: "pong",
    });

    const res = await responsePromise;
    const body = await res.json();

    expect(bus.publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({ content: "ping" }),
    );
    expect(body.reply).toEqual(expect.objectContaining({ content: "pong" }));
  });

  it("returns null reply immediately when wait=false", async () => {
    const bus = {
      subscribeOutbound: vi.fn(),
      publishInbound: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    const req = new Request("http://localhost/messages?wait=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });

    const res = await (channel as any).handleRequest(req);
    const body = await res.json();

    expect(body.reply).toBeNull();
  });

  it("returns null reply after wait timeout", async () => {
    vi.useFakeTimers();
    const bus = {
      subscribeOutbound: vi.fn(),
      publishInbound: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 20,
    });

    const req = new Request("http://localhost/messages?wait=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });

    const responsePromise = (channel as any).handleRequest(req);
    await vi.advanceTimersByTimeAsync(25);

    const res = await responsePromise;
    const body = await res.json();

    expect(body.reply).toBeNull();
    vi.useRealTimers();
  });

  it("returns gracefully when removing missing waiters", () => {
    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    expect(() =>
      (channel as any).removeWaiter("missing", { deliver: vi.fn() }),
    ).not.toThrow();
  });

  it("invokes the fetch callback passed to Bun.serve during start", async () => {
    let capturedOptions: any;
    (globalThis as any).Bun = {
      serve: serveMock.mockImplementation((opts: any) => {
        capturedOptions = opts;
        // invoke the provided fetch handler once to exercise arrow binding
        void opts.fetch(
          new Request("http://localhost/health", { method: "GET" }),
        );
        return { stop: serverStopMock };
      }),
    };

    const bus = { subscribeOutbound: vi.fn(), publishInbound: vi.fn() };
    const channel = new WebhookChannel(bus as any, {
      host: "127.0.0.1",
      port: 18080,
      waitTimeoutMs: 50,
    });

    await channel.start();
    expect(capturedOptions).toBeDefined();

    const res = await capturedOptions.fetch(
      new Request("http://localhost/health", { method: "GET" }),
    );
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
