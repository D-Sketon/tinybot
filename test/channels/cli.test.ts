import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachCliChannel } from "../../src/channels/cli.ts";

const { consolaLogMock } = vi.hoisted(() => ({
  consolaLogMock: vi.fn(),
}));

vi.mock("consola", () => ({ consola: { log: consolaLogMock } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cli channel", () => {
  it("logs outbound messages in standard mode", async () => {
    let handler: ((msg: any) => Promise<void>) | undefined;
    const bus = {
      subscribeOutbound: vi.fn(
        (channel: string, cb: (msg: any) => Promise<void>) => {
          if (channel === "cli") handler = cb;
        },
      ),
    };

    attachCliChannel(bus as any);
    await handler?.({ channel: "cli", chatId: "direct", content: "hello" });

    expect(consolaLogMock).toHaveBeenCalledWith(
      "\u001B[36mtinybot [direct]: hello\u001B[0m",
    );
  });

  it("logs outbound messages with metadata in verbose mode", async () => {
    let handler: ((msg: any) => Promise<void>) | undefined;
    const bus = {
      subscribeOutbound: vi.fn(
        (channel: string, cb: (msg: any) => Promise<void>) => {
          if (channel === "cli") handler = cb;
        },
      ),
    };

    attachCliChannel(bus as any, { verbose: true });
    await handler?.({
      channel: "cli",
      chatId: "direct",
      content: "hello",
      metadata: { debug: true },
    });

    expect(consolaLogMock).toHaveBeenCalledWith(
      "\u001B[36mtinybot(cli,verbose) [direct] ->\u001B[0m",
      `\u001B[36m${JSON.stringify(
        {
          channel: "cli",
          chatId: "direct",
          content: "hello",
          metadata: { debug: true },
        },
        null,
        2,
      )}\u001B[0m`,
    );
  });

  it("logs outbound messages without metadata in verbose mode", async () => {
    let handler: ((msg: any) => Promise<void>) | undefined;
    const bus = {
      subscribeOutbound: vi.fn(
        (channel: string, cb: (msg: any) => Promise<void>) => {
          if (channel === "cli") handler = cb;
        },
      ),
    };

    attachCliChannel(bus as any, { verbose: true });
    await handler?.({
      channel: "cli",
      chatId: "direct",
      content: "hello",
    });

    expect(consolaLogMock).toHaveBeenCalledWith(
      "\u001B[36mtinybot(cli,verbose) [direct] ->\u001B[0m",
      `\u001B[36m${JSON.stringify(
        {
          channel: "cli",
          chatId: "direct",
          content: "hello",
        },
        null,
        2,
      )}\u001B[0m`,
    );
  });

  it("uses writeLine callback to keep output rendering controlled", async () => {
    let handler: ((msg: any) => Promise<void>) | undefined;
    const writeLine = vi.fn();
    const bus = {
      subscribeOutbound: vi.fn(
        (channel: string, cb: (msg: any) => Promise<void>) => {
          if (channel === "cli") handler = cb;
        },
      ),
    };

    attachCliChannel(bus as any, { writeLine });
    await handler?.({ channel: "cli", chatId: "direct", content: "hello" });

    expect(writeLine).toHaveBeenCalledWith(
      "\u001B[36mtinybot [direct]: hello\u001B[0m",
    );
    expect(consolaLogMock).not.toHaveBeenCalled();
  });
});
