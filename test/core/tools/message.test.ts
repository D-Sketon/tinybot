import { describe, expect, it, vi } from "vitest";

import { MessageTool } from "../../../src/core/tools/message.ts";

describe("messageTool", () => {
  it("publishes outbound message using defaults", async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const bus = { publishOutbound };
    const tool = new MessageTool(bus as any);

    const result = await tool.execute({ content: "hello" });

    expect(publishOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "cli",
        chatId: "direct",
        content: "hello",
      }),
    );
    expect(result).toBe("Queued message to cli:direct");
  });

  it("publishes outbound message with overrides and metadata", async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const bus = { publishOutbound };
    const tool = new MessageTool(bus as any);

    const result = await tool.execute({
      content: "ping",
      channel: "webhook",
      chatId: "room",
      replyTo: "abc",
      media: ["a.png"],
      metadata: { foo: "bar" },
    });

    expect(publishOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webhook",
        chatId: "room",
        content: "ping",
        replyTo: "abc",
        media: ["a.png"],
        metadata: { foo: "bar" },
      }),
    );
    expect(result).toBe("Queued message to webhook:room");
  });

  it("validates media items are strings", () => {
    const tool = new MessageTool({ publishOutbound: vi.fn() } as any);
    const errors = tool.validate({ content: "x", media: ["ok", 1] as any });
    expect(errors).toContain("Value at 'media/1' should be string");
  });

  it("validates optional fields and empty content", () => {
    const tool = new MessageTool({ publishOutbound: vi.fn() } as any);
    const errors = tool.validate({
      content: "  ",
      channel: 1 as any,
      chatId: false as any,
      replyTo: {} as any,
      media: "nope" as any,
    });
    expect(errors).toContain("Value at 'channel' should be string");
    expect(errors).toContain("Value at 'chatId' should be string");
    expect(errors).toContain("Value at 'replyTo' should be string");
    expect(errors).toContain("Value at 'media' should be array");
  });

  it("rejects empty content and missing target", async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const tool = new MessageTool({ publishOutbound } as any);

    await expect(tool.execute({ content: "   " })).rejects.toThrow(
      "content must not be empty",
    );
    await expect(
      tool.execute({ content: "hi", channel: "", chatId: "" }),
    ).rejects.toThrow("Unable to determine target channel/chatId");
  });

  it("queues outbound messages and returns status", async () => {
    const pub = vi.fn().mockResolvedValue(undefined);
    const tool = new MessageTool({ publishOutbound: pub } as any);

    const res = await tool.execute({
      content: "hello",
      channel: "cli",
      chatId: "room",
    });
    expect(pub).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "hello",
        channel: "cli",
        chatId: "room",
      }),
    );
    expect(res).toContain("Queued message to cli:room");
  });
});
