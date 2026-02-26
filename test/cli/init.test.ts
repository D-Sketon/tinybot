import { beforeEach, describe, expect, it, vi } from "vitest";

import { runInit } from "../../src/cli/init.ts";

const {
  existsSyncMock,
  mkdirMock,
  readFileMock,
  writeFileMock,
  consolaLogMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  mkdirMock: vi.fn().mockResolvedValue(undefined),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  consolaLogMock: vi.fn(),
}));

vi.mock("node:fs", () => ({ existsSync: existsSyncMock }));
vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
}));
vi.mock("consola", () => ({ consola: { log: consolaLogMock } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runInit", () => {
  it("skips config when it already exists and not forced", async () => {
    existsSyncMock.mockImplementation((target: string) =>
      String(target).endsWith("tinybot.config.json"),
    );

    await runInit({});

    const configWrite = writeFileMock.mock.calls.find(([target]) =>
      String(target).endsWith("tinybot.config.json"),
    );
    expect(configWrite).toBeUndefined();
    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("Config already exists"),
    );
  });

  it("writes config using the example template when available", async () => {
    existsSyncMock.mockReturnValue(false);
    readFileMock.mockResolvedValueOnce('{"channels":{}}');

    await runInit({ config: "custom.json", workspace: "./workspace-test" });

    const configWrite = writeFileMock.mock.calls.find(([target]) =>
      String(target).endsWith("custom.json"),
    );
    expect(configWrite).toBeDefined();
    expect(configWrite?.[1]).toBe('{"channels":{}}');
    expect(consolaLogMock).toHaveBeenCalledWith(
      expect.stringContaining("Config written"),
    );
  });

  it("falls back to default config when example is invalid", async () => {
    existsSyncMock.mockReturnValue(false);
    readFileMock.mockRejectedValueOnce(new Error("missing"));

    await runInit({ config: "fallback.json" });

    const configWrite = writeFileMock.mock.calls.find(([target]) =>
      String(target).endsWith("fallback.json"),
    );
    expect(typeof configWrite?.[1]).toBe("string");
    expect((configWrite?.[1] as string).trim().startsWith("{")).toBe(true);
  });

  it("skips existing workspace files when not forced", async () => {
    existsSyncMock.mockImplementation((target: string) =>
      String(target).includes("AGENTS.md"),
    );
    readFileMock.mockRejectedValueOnce(new Error("missing"));

    await runInit({ workspace: "./workspace-test" });

    const agentsWrite = writeFileMock.mock.calls.find(([target]) =>
      String(target).includes("AGENTS.md"),
    );
    expect(agentsWrite).toBeUndefined();
  });

  it("creates workspace files when missing", async () => {
    existsSyncMock.mockReturnValue(false);
    readFileMock.mockRejectedValueOnce(new Error("missing"));

    await runInit({ workspace: "./workspace-new" });

    const agentsWrite = writeFileMock.mock.calls.find(([target]) =>
      String(target).includes("AGENTS.md"),
    );
    const soulWrite = writeFileMock.mock.calls.find(([target]) =>
      String(target).includes("SOUL.md"),
    );

    expect(agentsWrite).toBeDefined();
    expect(soulWrite).toBeDefined();
  });
});
