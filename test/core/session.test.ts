import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionManager } from "../../src/core/session.ts";

const { readFileMock, writeFileMock, mkdirMock, readdirMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  mkdirMock: vi.fn().mockResolvedValue(undefined),
  readdirMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  mkdir: mkdirMock,
  readdir: readdirMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sessionManager", () => {
  it("creates a new session when none exists", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));

    const manager = new SessionManager("/workspace");
    const session = await manager.getOrCreate("cli:default");

    expect(session.id).toBe("cli:default");
    expect(session.messages).toEqual([]);
  });

  it("parses legacy array payloads and clamps history", async () => {
    const legacy = JSON.stringify([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    readFileMock.mockResolvedValueOnce(legacy);

    const manager = new SessionManager("/workspace", 2);
    const session = await manager.getOrCreate("cli:history");

    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]?.content).toBe("two");
    expect(session.messages[1]?.content).toBe("three");
  });

  it("persists sessions with timestamps and clamped history", async () => {
    const manager = new SessionManager("/workspace", 2);
    const session = {
      id: "cli:save",
      messages: [
        { role: "user" as const, content: "one" },
        { role: "assistant" as const, content: "two" },
        { role: "user" as const, content: "three" },
      ],
      metadata: {},
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    await manager.save(session);

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writeFileMock.mock.calls[0]?.[1] as string);
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0].timestamp).toBeTruthy();
    expect(session.messages).toHaveLength(2);
  });

  it("parses persisted sessions and strips timestamps", async () => {
    const persisted = JSON.stringify({
      id: "cli:save",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      metadata: { note: "x" },
      messages: [
        { role: "user", content: "one", timestamp: "2024-01-01T00:00:00.000Z" },
        {
          role: "assistant",
          content: "two",
          timestamp: "2024-01-01T00:00:01.000Z",
        },
      ],
    });
    readFileMock.mockResolvedValueOnce(persisted);

    const manager = new SessionManager("/workspace");
    const session = await manager.getOrCreate("cli:save");

    expect(session.metadata).toEqual({ note: "x" });
    expect((session.messages[0] as any).timestamp).toBeUndefined();
    expect(session.messages[1]?.content).toBe("two");
  });

  it("returns a fresh session when payload is invalid", async () => {
    readFileMock.mockResolvedValueOnce("not json");

    const manager = new SessionManager("/workspace");
    const session = await manager.getOrCreate("cli:bad");

    expect(session.id).toBe("cli:bad");
    expect(session.messages).toEqual([]);
  });

  it("sanitizes session keys in filenames", async () => {
    const manager = new SessionManager("/workspace");
    const session = {
      id: "cli:room/1\\2",
      messages: [],
      metadata: {},
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    await manager.save(session);

    const targetPath = String(writeFileMock.mock.calls[0]?.[0]);
    expect(targetPath).toContain("cli_room_1_2.json");
  });

  it("returns fresh session when persisted object lacks messages field", async () => {
    const obj = JSON.stringify({ id: "x", createdAt: "2020" });
    readFileMock.mockResolvedValueOnce(obj);

    const manager = new SessionManager("/workspace");
    const session = await manager.getOrCreate("cli:missing_msgs");

    expect(session.id).toBe("cli:missing_msgs");
    expect(session.messages).toEqual([]);
  });

  it("fills createdAt when missing on save and updates updatedAt", async () => {
    const manager = new SessionManager("/workspace");
    const session: any = {
      id: "cli:fill",
      messages: [],
      metadata: {},
    };

    await manager.save(session);

    const payload = JSON.parse(writeFileMock.mock.calls[0]?.[1] as string);
    expect(payload.createdAt).toBeTruthy();
    expect(payload.updatedAt).toBeTruthy();
    expect(session.createdAt).toBeTruthy();
    expect(session.updatedAt).toBeTruthy();
  });

  it("lists sessions sorted by updatedAt desc", async () => {
    readdirMock.mockResolvedValueOnce(["a.json", "b.json", "ignore.txt"]);
    readFileMock
      .mockResolvedValueOnce(
        JSON.stringify({
          id: "cli:old",
          updatedAt: "2026-02-24T10:00:00.000Z",
          messages: [{ role: "user", content: "old" }],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          id: "cli:new",
          updatedAt: "2026-02-24T11:00:00.000Z",
          messages: [{ role: "assistant", content: "new" }],
        }),
      );

    const manager = new SessionManager("/workspace");
    const sessions = await manager.listSessions();

    expect(sessions.map((row) => row.id)).toEqual(["cli:new", "cli:old"]);
  });

  it("returns null history when session file is missing", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));

    const manager = new SessionManager("/workspace");
    const history = await manager.getHistory("cli:none", 5);

    expect(history).toBeNull();
  });

  it("returns clamped history when session exists", async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        id: "cli:hist",
        messages: [
          { role: "user", content: "1", timestamp: "a" },
          { role: "assistant", content: "2", timestamp: "b" },
          { role: "user", content: "3", timestamp: "c" },
        ],
      }),
    );

    const manager = new SessionManager("/workspace");
    const history = await manager.getHistory("cli:hist", 2);

    expect(history).toHaveLength(2);
    expect((history?.[0] as any).timestamp).toBeUndefined();
    expect(history?.[1]?.content).toBe("3");
  });
});
