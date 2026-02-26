import { Buffer } from "node:buffer";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EditFileTool,
  ListDirTool,
  ReadFileTool,
  WriteFileTool,
} from "../../../src/core/tools/fs.ts";

const {
  entries,
  mkdirSyncMock,
  writeFileSyncMock,
  readFileSyncMock,
  readdirSyncMock,
  statSyncMock,
} = vi.hoisted(() => {
  const entries = new Map<
    string,
    { content?: string; isFile?: boolean; isDirectory?: boolean; size?: number }
  >();
  return {
    entries,
    mkdirSyncMock: vi.fn(),
    writeFileSyncMock: vi.fn((target: string, content: string) => {
      entries.set(target, {
        content,
        isFile: true,
        size: Buffer.byteLength(content, "utf-8"),
      });
    }),
    readFileSyncMock: vi.fn((target: string) => {
      const entry = entries.get(target);
      if (!entry || !entry.isFile) {
        throw new Error("ENOENT");
      }
      return entry.content ?? "";
    }),
    readdirSyncMock: vi.fn((dir: string) => {
      const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
      const names = new Set<string>();
      for (const key of entries.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes(path.sep)) {
          names.add(rest);
        }
      }
      return Array.from(names);
    }),
    statSyncMock: vi.fn((target: string) => {
      const entry = entries.get(target);
      if (!entry) {
        throw new Error("ENOENT");
      }
      const size =
        entry.size ?? Buffer.byteLength(entry.content ?? "", "utf-8");
      return {
        isFile: () => Boolean(entry.isFile),
        isDirectory: () => Boolean(entry.isDirectory),
        size,
      };
    }),
  };
});

vi.mock("node:fs", () => ({
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
  readFileSync: readFileSyncMock,
  readdirSync: readdirSyncMock,
  statSync: statSyncMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  entries.clear();
});

describe("fs tools", () => {
  it("reads a file and enforces maxBytes", async () => {
    const workspace = "C:\\workspace";
    const target = path.join(workspace, "notes.txt");
    entries.set(target, { content: "hello", isFile: true, size: 5 });

    const tool = new ReadFileTool(workspace);
    const result = await tool.execute({ path: "notes.txt" });
    expect(result).toBe("hello");

    await expect(
      tool.execute({ path: "notes.txt", maxBytes: 3 }),
    ).rejects.toThrow("File too large");
  });

  it("validates read/write/edit/list args", () => {
    const workspace = "C:\\workspace";
    expect(new ReadFileTool(workspace).validate({})).toContain(
      "Value must have required property 'path'",
    );
    expect(
      new ReadFileTool(workspace).validate({ path: "a", maxBytes: "x" as any }),
    ).toContain("Value at 'maxBytes' should be number");
    expect(
      new WriteFileTool(workspace).validate({ path: "a", content: 1 as any }),
    ).toContain("Value at 'content' should be string");
    expect(
      new EditFileTool(workspace).validate({
        path: "a",
        oldText: "",
        newText: 1 as any,
      }),
    ).toContain("Value at 'newText' should be string");
    expect(
      new EditFileTool(workspace).validate({
        path: "a",
        oldText: "x",
        newText: 1 as any,
      }),
    ).toContain("Value at 'newText' should be string");
    expect(
      new EditFileTool(workspace).validate({
        path: "a",
        oldText: "x",
        newText: "y",
        occurrence: "1" as any,
      }),
    ).toContain("Value at 'occurrence' should be number");
    expect(new ListDirTool(workspace).validate({ path: 1 as any })).toContain(
      "Value at 'path' should be string",
    );
    expect(new ListDirTool(workspace).validate({})).toEqual([]);
  });

  it("writes a file under the workspace", async () => {
    const workspace = "C:\\workspace";
    const tool = new WriteFileTool(workspace);

    const result = await tool.execute({ path: "logs/out.txt", content: "ok" });

    expect(result).toBe("ok");
    expect(mkdirSyncMock).toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      path.join(workspace, "logs", "out.txt"),
      "ok",
      "utf-8",
    );
  });

  it("edits a file by replacing a snippet", async () => {
    const workspace = "C:\\workspace";
    const target = path.join(workspace, "file.txt");
    entries.set(target, { content: "hello world", isFile: true, size: 11 });

    const tool = new EditFileTool(workspace);
    const result = await tool.execute({
      path: "file.txt",
      oldText: "world",
      newText: "there",
    });

    expect(result).toBe("ok");
    expect(readFileSyncMock).toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      target,
      "hello there",
      "utf-8",
    );
  });

  it("rejects when read/edit targets are not files", async () => {
    const workspace = "C:\\workspace";
    const dir = path.join(workspace, "dir");
    entries.set(dir, { isDirectory: true, size: 0 });

    const readTool = new ReadFileTool(workspace);
    const editTool = new EditFileTool(workspace);

    await expect(readTool.execute({ path: "dir" })).rejects.toThrow(
      "Target is not a file",
    );
    await expect(
      editTool.execute({ path: "dir", oldText: "a", newText: "b" }),
    ).rejects.toThrow("Target is not a file");
  });

  it("rejects when list target is not a directory", async () => {
    const workspace = "C:\\workspace";
    const file = path.join(workspace, "file.txt");
    entries.set(file, { isFile: true, size: 1, content: "x" });

    const tool = new ListDirTool(workspace);

    await expect(tool.execute({ path: "file.txt" })).rejects.toThrow(
      "Target is not a directory",
    );
  });

  it("rejects edit when oldText is missing or ambiguous", async () => {
    const workspace = "C:\\workspace";
    const target = path.join(workspace, "multi.txt");
    entries.set(target, { content: "a a a", isFile: true, size: 5 });

    const tool = new EditFileTool(workspace);

    await expect(
      tool.execute({ path: "multi.txt", oldText: "b", newText: "c" }),
    ).rejects.toThrow("oldText not found in file");
    await expect(
      tool.execute({ path: "multi.txt", oldText: "a", newText: "c" }),
    ).rejects.toThrow("Match found 3 times");
    await expect(
      tool.execute({ path: "multi.txt", oldText: "", newText: "c" }),
    ).rejects.toThrow("oldText must not be empty");
    await expect(
      tool.execute({
        path: "multi.txt",
        oldText: "a",
        newText: "c",
        occurrence: 4,
      }),
    ).rejects.toThrow("occurrence must be between 1 and 3");
  });

  it("lists directory entries with size and kind", async () => {
    const workspace = "C:\\workspace";
    const targetDir = path.join(workspace, "data");
    entries.set(targetDir, { isDirectory: true, size: 0 });
    entries.set(path.join(targetDir, "a.txt"), {
      content: "a",
      isFile: true,
      size: 1,
    });
    entries.set(path.join(targetDir, "sub"), { isDirectory: true, size: 0 });

    const tool = new ListDirTool(workspace);
    const result = await tool.execute({ path: "data" });

    expect(result).toContain("data\\a.txt\tfile\t1");
    expect(result).toContain("data\\sub\tdir\t0");
  });

  it("rejects paths that escape the workspace", async () => {
    const workspace = "C:\\workspace";
    const tool = new ReadFileTool(workspace);

    await expect(tool.execute({ path: "..\\secret.txt" })).rejects.toThrow(
      "Path escapes workspace",
    );
  });
});
