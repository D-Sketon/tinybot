import type { InboundMessage, OutboundMessage } from "../../src/core/bus.ts";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBus } from "../../src/core/bus.ts";

const { consolaWarnMock } = vi.hoisted(() => ({
  consolaWarnMock: vi.fn(),
}));

vi.mock("consola", () => ({ consola: { warn: consolaWarnMock } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("messageBus", () => {
  it("publishes and consumes inbound messages", async () => {
    const bus = new MessageBus();
    const inbound: InboundMessage = {
      channel: "cli",
      senderId: "user",
      chatId: "direct",
      content: "hello",
    };

    await bus.publishInbound(inbound);
    const received = await bus.consumeInbound();

    expect(received).toEqual(inbound);
  });

  it("dispatches outbound messages to subscribers and logs failures", async () => {
    const bus = new MessageBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    const failingHandler = vi.fn().mockRejectedValue(new Error("boom"));
    bus.subscribeOutbound("cli", handler);
    bus.subscribeOutbound("cli", failingHandler);

    const dispatchPromise = bus.dispatchOutbound();

    const outbound: OutboundMessage = {
      channel: "cli",
      chatId: "direct",
      content: "hi",
    };
    await bus.publishOutbound(outbound);

    await new Promise((resolve) => setTimeout(resolve, 0));
    bus.stopDispatch();
    await dispatchPromise;

    expect(handler).toHaveBeenCalledWith(outbound);
    expect(consolaWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to deliver message"),
    );
  });

  it("stopDispatch unblocks the dispatcher", async () => {
    const bus = new MessageBus();
    const dispatchPromise = bus.dispatchOutbound();

    await new Promise((resolve) => setTimeout(resolve, 0));
    bus.stopDispatch();

    await dispatchPromise;
    expect(bus.outboundSize).toBe(0);
  });

  it("dispatchOutbound returns early when already running", async () => {
    const bus = new MessageBus();
    (bus as any).running = true;
    await expect(bus.dispatchOutbound()).resolves.toBeUndefined();
  });

  it("unsubscribe stops delivering outbound messages", async () => {
    const bus = new MessageBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribeOutbound("cli", handler);
    bus.unsubscribeOutbound("cli", handler);

    const dispatchPromise = bus.dispatchOutbound();
    await bus.publishOutbound({
      channel: "cli",
      chatId: "room",
      content: "ping",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    bus.stopDispatch();
    await dispatchPromise;

    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks inbound and outbound queue sizes", async () => {
    const bus = new MessageBus();
    expect(bus.inboundSize).toBe(0);
    expect(bus.outboundSize).toBe(0);

    await bus.publishInbound({
      channel: "cli",
      senderId: "user",
      chatId: "room",
      content: "hello",
    });
    await bus.publishOutbound({
      channel: "cli",
      chatId: "room",
      content: "hi",
    });

    expect(bus.inboundSize).toBe(1);
    expect(bus.outboundSize).toBe(1);
  });

  it("returns null from consumeInbound after stopDispatch", async () => {
    const bus = new MessageBus();
    bus.stopDispatch();

    const inbound = await bus.consumeInbound();

    expect(inbound).toBeNull();
  });

  it("resolves pending consume promise when a waiter exists", async () => {
    const bus = new MessageBus();

    // start a pending consumer (waiter)
    const pending = bus.consumeInbound();

    // publish a message which should resolve the waiter instead of queuing
    const msg = {
      channel: "cli",
      senderId: "user",
      chatId: "room",
      content: "delivered",
    };

    await bus.publishInbound(msg);

    const received = await pending;
    expect(received).toEqual(msg);
    expect(bus.inboundSize).toBe(0);
  });

  it("ignores enqueue requests after queue is closed", async () => {
    const bus = new MessageBus();
    // close queues
    bus.stopDispatch();

    await bus.publishInbound({
      channel: "cli",
      senderId: "user",
      chatId: "room",
      content: "should be ignored",
    });

    // inbound size remains zero when closed
    expect(bus.inboundSize).toBe(0);
  });
});
