import { describe, expect, it, vi } from "vitest";

import {
  SessionsHistoryTool,
  SessionsListTool,
  SessionsSendTool,
} from "../../../src/core/tools/sessions.ts";

describe("sessionsListTool", () => {
  it("lists sessions", async () => {
    const sessions = {
      listSessions: vi.fn().mockResolvedValue([
        {
          id: "cli:direct",
          updatedAt: "2026-02-24T12:00:00.000Z",
          messageCount: 4,
        },
      ]),
    };

    const tool = new SessionsListTool(sessions as any);
    const result = await tool.execute({});

    expect(result).toContain("cli:direct");
    expect(result).toContain("messages: 4");
  });

  it("returns empty state message", async () => {
    const tool = new SessionsListTool({ listSessions: vi.fn().mockResolvedValue([]) } as any);
    await expect(tool.execute({})).resolves.toBe("No sessions found.");
  });
});

describe("sessionsHistoryTool", () => {
  it("returns formatted history", async () => {
    const sessions = {
      getHistory: vi.fn().mockResolvedValue([
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ]),
    };
    const tool = new SessionsHistoryTool(sessions as any);

    const result = await tool.execute({ sessionId: "cli:direct", limit: 2 });

    expect(sessions.getHistory).toHaveBeenCalledWith("cli:direct", 2);
    expect(result).toContain("[user] hello");
    expect(result).toContain("[assistant] world");
  });

  it("handles missing/empty sessions", async () => {
    const missing = new SessionsHistoryTool({ getHistory: vi.fn().mockResolvedValue(null) } as any);
    await expect(missing.execute({ sessionId: "cli:missing" })).resolves.toContain("not found");

    const empty = new SessionsHistoryTool({ getHistory: vi.fn().mockResolvedValue([]) } as any);
    await expect(empty.execute({ sessionId: "cli:empty" })).resolves.toContain("no messages");
  });

  it("rejects invalid arguments", async () => {
    const tool = new SessionsHistoryTool({ getHistory: vi.fn() } as any);
    await expect(tool.execute({})).rejects.toThrow("sessionId must be provided");
  });
});

describe("sessionsSendTool", () => {
  it("publishes inbound to target session", async () => {
    const publishInbound = vi.fn().mockResolvedValue(undefined);
    const tool = new SessionsSendTool({ publishInbound } as any);
    tool.setOrigin("cli", "direct");

    const result = await tool.execute({
      to: "cli:worker",
      content: "please summarize",
      senderId: "coordinator",
    });

    expect(publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "cli",
        chatId: "worker",
        senderId: "coordinator",
        content: "please summarize",
      }),
    );
    expect(result).toBe("Sent message to cli:worker");
  });

  it("supports reply-back metadata", async () => {
    const publishInbound = vi.fn().mockResolvedValue(undefined);
    const tool = new SessionsSendTool({ publishInbound } as any);
    tool.setOrigin("cli", "coordinator");

    const result = await tool.execute({
      to: "cli:worker",
      content: "run task",
      replyBack: true,
    });

    expect(publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          replyBackTo: { channel: "cli", chatId: "coordinator" },
        }),
      }),
    );
    expect(result).toContain("reply-back enabled");
  });

  it("rejects invalid target and empty content", async () => {
    const tool = new SessionsSendTool({ publishInbound: vi.fn() } as any);
    await expect(tool.execute({ to: "invalid", content: "x" })).rejects.toThrow(
      "'to' must be formatted as 'channel:chatId'",
    );
    await expect(tool.execute({ to: "cli:worker", content: "  " })).rejects.toThrow(
      "content must not be empty",
    );
  });
});
