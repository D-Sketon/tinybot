import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecTool } from "../../../src/core/tools/exec.ts";

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("execTool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stdout on success", async () => {
    const spawnMock = vi.fn().mockReturnValue({
      stdout: streamFrom("hello\n"),
      stderr: streamFrom(""),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    });
    (globalThis as any).Bun = { spawn: spawnMock };

    const tool = new ExecTool("C:\\workspace", { timeout: 5000 });
    const result = await tool.execute({ command: "echo hello" });

    expect(result).toBe("hello");
    expect(spawnMock).toHaveBeenCalled();
  });

  it("returns stderr/stdout on non-zero exit", async () => {
    const spawnMock = vi.fn().mockReturnValue({
      stdout: streamFrom("out"),
      stderr: streamFrom("err"),
      exited: Promise.resolve(2),
      kill: vi.fn(),
    });
    (globalThis as any).Bun = { spawn: spawnMock };

    const tool = new ExecTool("C:\\workspace", { timeout: 5000 });
    const result = await tool.execute({ command: "badcmd" });

    expect(result).toContain("exit 2");
    expect(result).toContain("stderr:");
    expect(result).toContain("stdout:");
  });

  it("times out and kills the process", async () => {
    vi.useFakeTimers();
    const killMock = vi.fn();
    const spawnMock = vi.fn().mockReturnValue({
      stdout: streamFrom(""),
      stderr: streamFrom(""),
      exited: new Promise(() => {}),
      kill: killMock,
    });
    (globalThis as any).Bun = { spawn: spawnMock };

    const tool = new ExecTool("C:\\workspace", { timeout: 10 });
    const promise = tool.execute({ command: "sleep" });

    await vi.advanceTimersByTimeAsync(20);

    await expect(promise).rejects.toThrow("Command timed out");
    expect(killMock).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rejects commands denied by allow/deny lists", async () => {
    const spawnMock = vi.fn();
    (globalThis as any).Bun = { spawn: spawnMock };

    const tool = new ExecTool("C:\\workspace", {
      timeout: 5000,
      allow: ["^echo "],
      deny: ["forbidden"],
    });

    await expect(tool.execute({ command: "ls" })).rejects.toThrow("allow-list");
    await expect(tool.execute({ command: "echo forbidden" })).rejects.toThrow(
      "deny-list",
    );
  });

  it("blocks traversal and absolute paths when restricted", async () => {
    const spawnMock = vi.fn();
    (globalThis as any).Bun = { spawn: spawnMock };

    const tool = new ExecTool("C:\\workspace", {
      timeout: 5000,
      restrictToWorkspace: true,
    });

    await expect(
      tool.execute({ command: "cat ..\\secret.txt" }),
    ).rejects.toThrow("outside-workspace path");
    await expect(
      tool.execute({ command: "cat C:\\Windows\\win.ini" }),
    ).rejects.toThrow("outside-workspace path");
    await expect(tool.execute({ command: "cat /etc/passwd" })).rejects.toThrow(
      "outside-workspace path",
    );
    await expect(
      tool.execute({ command: "cat ..%2Fsecret.txt" }),
    ).rejects.toThrow("outside-workspace path");
  });

  it("does not block non-path usage of dots when restricted", async () => {
    const spawnMock = vi.fn().mockReturnValue({
      stdout: streamFrom("..."),
      stderr: streamFrom(""),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    });
    (globalThis as any).Bun = { spawn: spawnMock };

    const tool = new ExecTool("C:\\workspace", {
      timeout: 5000,
      restrictToWorkspace: true,
    });

    await expect(tool.execute({ command: "echo ..." })).resolves.toBe("...");
  });

  it("validates command and timeout types", () => {
    const tool = new ExecTool("C:\\workspace", { timeout: 5000 });

    expect(tool.validate({})).toContain(
      "Value must have required property 'command'",
    );
    expect(tool.validate({ command: "ok", timeout: "fast" as any })).toContain(
      "Value at 'timeout' should be number",
    );
  });

  it("handles decodeURIComponent throwing inside workspace check", async () => {
    const spawnMock = vi.fn();
    (globalThis as any).Bun = { spawn: spawnMock };

    // stub global decodeURIComponent to throw to hit the catch branch
    const orig = (globalThis as any).decodeURIComponent;
    vi.stubGlobal("decodeURIComponent", () => {
      throw new Error("bad");
    });

    const tool = new ExecTool("C:\\workspace", {
      timeout: 5000,
      restrictToWorkspace: true,
    });

    await expect(
      tool.execute({ command: "cat ..\\secret.txt" }),
    ).rejects.toThrow("outside-workspace path");

    // restore original
    vi.stubGlobal("decodeURIComponent", orig);
  });
});
