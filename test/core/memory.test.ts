import { Buffer } from "node:buffer";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStore } from "../../src/core/memory.ts";

const {
  files,
  existsSyncMock,
  statSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
  appendFileSyncMock,
  mkdirSyncMock,
  readdirSyncMock,
} = vi.hoisted(() => {
  const files = new Map<string, { content: string; isFile: boolean }>();
  return {
    files,
    existsSyncMock: vi.fn((target: string) => {
      if (files.has(target)) return true;
      const prefix = target.endsWith(path.sep)
        ? target
        : `${target}${path.sep}`;
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    }),
    statSyncMock: vi.fn((target: string) => {
      const entry = files.get(target);
      if (!entry) {
        throw new Error("ENOENT");
      }
      return {
        isFile: () => entry.isFile,
        size: Buffer.byteLength(entry.content, "utf-8"),
      };
    }),
    readFileSyncMock: vi.fn((target: string) => {
      const entry = files.get(target);
      if (!entry) {
        throw new Error("ENOENT");
      }
      return entry.content;
    }),
    writeFileSyncMock: vi.fn((target: string, content: string) => {
      files.set(target, { content: String(content), isFile: true });
    }),
    appendFileSyncMock: vi.fn((target: string, content: string) => {
      const entry = files.get(target);
      const next = `${entry?.content ?? ""}${String(content)}`;
      files.set(target, { content: next, isFile: true });
    }),
    mkdirSyncMock: vi.fn(),
    readdirSyncMock: vi.fn((dir: string) => {
      const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes(path.sep)) {
          names.add(rest);
        }
      }
      return Array.from(names);
    }),
  };
});

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
  appendFileSync: appendFileSyncMock,
  mkdirSync: mkdirSyncMock,
  readdirSync: readdirSyncMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  vi.useRealTimers();
});

describe("memoryStore", () => {
  it("writes and reads long-term memory", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);
    const target = path.join(workspace, "memory", "MEMORY.md");

    store.writeLongTerm("hello");

    expect(mkdirSyncMock).toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledWith(target, "hello", "utf-8");
    expect(store.readLongTerm()).toBe("hello");
  });

  it("builds context from recent notes and truncates when needed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-09T12:00:00Z"));

    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);
    const memoryDir = path.join(workspace, "memory");
    files.set(path.join(memoryDir, "MEMORY.md"), {
      content: "LT",
      isFile: true,
    });
    files.set(path.join(memoryDir, "2026-02-09.md"), {
      content: "daily note",
      isFile: true,
    });

    const context = store.getMemoryContext();

    expect(context).toContain("# Memory");
    expect(context).toContain("LT");
    expect(context).toContain("# 2026-02-09");
    expect(context).toContain("daily note");

    files.set(path.join(memoryDir, "MEMORY.md"), {
      content: "a".repeat(9000),
      isFile: true,
    });
    const truncated = store.getMemoryContext();
    expect(truncated).toContain("[truncated memory]");
  });

  it("lists only markdown files in memory dir", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);
    const memoryDir = path.join(workspace, "memory");
    files.set(path.join(memoryDir, "2026-02-09.md"), {
      content: "note",
      isFile: true,
    });
    files.set(path.join(memoryDir, "notes.txt"), {
      content: "ignore",
      isFile: true,
    });

    const filesList = store.listMemoryFiles();

    expect(filesList).toEqual(["2026-02-09.md"]);
  });

  it("rejects invalid dates for daily notes", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);

    expect(() => store.readDailyNote("not-a-date")).toThrow(
      "Invalid date supplied",
    );
  });

  it("rejects oversized long-term memory writes", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);
    const big = "a".repeat(2_000_001);

    expect(() => store.writeLongTerm(big)).toThrow("Memory content too large");
  });

  it("skips non-file or oversized entries when reading", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);
    const memoryDir = path.join(workspace, "memory");
    files.set(path.join(memoryDir, "MEMORY.md"), {
      content: "data",
      isFile: false,
    });

    expect(store.readLongTerm()).toBeNull();

    files.set(path.join(memoryDir, "MEMORY.md"), {
      content: "a".repeat(2_000_001),
      isFile: true,
    });
    expect(store.readLongTerm()).toBeNull();
  });

  it("returns empty recent memories when days <= 0", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);

    expect(store.getRecentMemories(0)).toBe("");
  });

  it("appends daily note and can read it back", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);
    const date = new Date("2026-02-10T00:00:00Z");

    store.appendDailyNote("note content", date);

    const read = store.readDailyNote(date);
    expect(String(read)).toContain("note content");
  });

  it("listMemoryFiles returns empty array when memory dir missing", () => {
    const workspace = "C:\\workspace";
    const store = new MemoryStore(workspace);

    const list = store.listMemoryFiles();
    expect(list).toEqual([]);
  });
});
