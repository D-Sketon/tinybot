import type { ToolSchema } from "./base.ts";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { BaseTool } from "./base.ts";

/**
 * Resolves a relative path and rejects targets outside the workspace root.
 */
function resolveWorkspacePath(workspace: string, target: string): string {
  const resolved = path.resolve(workspace, target);
  const root = path.resolve(workspace) + path.sep;
  if (!resolved.startsWith(root) && resolved !== path.resolve(workspace)) {
    throw new Error("Path escapes workspace");
  }
  return resolved;
}

function describeEntry(workspace: string, entryPath: string): string {
  const rel = path.relative(workspace, entryPath) || ".";
  const stats = statSync(entryPath);
  const kind = stats.isDirectory() ? "dir" : stats.isFile() ? "file" : "other";
  return `${rel}\t${kind}\t${stats.size}`;
}

function assertIsFile(target: string): void {
  if (!statSync(target).isFile()) {
    throw new Error("Target is not a file");
  }
}

function assertIsDirectory(target: string): void {
  if (!statSync(target).isDirectory()) {
    throw new Error("Target is not a directory");
  }
}

/**
 * Reads text files from the workspace with size limits.
 */
export class ReadFileTool extends BaseTool {
  override readonly name = "read_file";
  override readonly description = "Read a text file from the workspace.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file." },
        maxBytes: {
          type: "number",
          description: "Optional size limit; defaults to 100000 bytes.",
        },
      },
      required: ["path"],
    },
  };

  constructor(private workspace: string) {
    super();
  }

  /**
   * Returns UTF-8 file content for a validated workspace path.
   */
  async execute(args: Record<string, unknown>): Promise<string> {
    const maxBytes =
      typeof args.maxBytes === "number" ? args.maxBytes : 100_000;
    const target = resolveWorkspacePath(this.workspace, args.path as string);
    assertIsFile(target);
    const stats = statSync(target);
    if (stats.size > maxBytes) {
      throw new Error(`File too large (${stats.size} bytes)`);
    }
    return readFileSync(target, "utf-8");
  }
}

/**
 * Writes text content to workspace files, creating parent directories when needed.
 */
export class WriteFileTool extends BaseTool {
  override readonly name = "write_file";
  override readonly description = "Write text content to a workspace file.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to write." },
        content: { type: "string", description: "Content to write." },
      },
      required: ["path", "content"],
    },
  };

  constructor(private workspace: string) {
    super();
  }

  /**
   * Writes UTF-8 content to a validated workspace path.
   */
  async execute(args: Record<string, unknown>): Promise<string> {
    const target = resolveWorkspacePath(this.workspace, args.path as string);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, args.content as string, "utf-8");
    return "ok";
  }
}

function replaceOccurrence(
  source: string,
  search: string,
  replacement: string,
  occurrence?: number,
): [string, number] {
  if (!search) {
    throw new Error("oldText must not be empty");
  }

  const parts = source.split(search);
  const count = parts.length - 1;
  if (count === 0) {
    return [source, 0];
  }

  if (occurrence === undefined) {
    if (count > 1) {
      throw new Error(
        `Match found ${count} times; specify occurrence to disambiguate.`,
      );
    }
    return [parts.join(replacement), 1];
  }

  if (occurrence < 1 || occurrence > count) {
    throw new Error(`occurrence must be between 1 and ${count}`);
  }

  const before = parts.slice(0, occurrence).join(search);
  const after = parts.slice(occurrence).join(search);
  const result = `${before}${replacement}${after}`;
  return [result, 1];
}

/**
 * Replaces exact text snippets in workspace files.
 */
export class EditFileTool extends BaseTool {
  override readonly name = "edit_file";
  override readonly description =
    "Edit a file by replacing an exact snippet with new content.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file." },
        oldText: { type: "string", description: "Exact snippet to replace." },
        newText: { type: "string", description: "Replacement text." },
        occurrence: {
          type: "number",
          description:
            "Optional 1-based occurrence to replace when multiple matches exist.",
        },
      },
      required: ["path", "oldText", "newText"],
    },
  };

  constructor(private workspace: string) {
    super();
  }

  /**
   * Applies one exact text replacement and persists the updated file.
   */
  async execute(args: Record<string, unknown>): Promise<string> {
    const target = resolveWorkspacePath(this.workspace, args.path as string);
    assertIsFile(target);
    const current = readFileSync(target, "utf-8");
    const [updated, replaced] = replaceOccurrence(
      current,
      args.oldText as string,
      args.newText as string,
      typeof args.occurrence === "number" ? args.occurrence : undefined,
    );
    if (replaced === 0) {
      throw new Error("oldText not found in file");
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, updated, "utf-8");
    return "ok";
  }
}

/**
 * Lists entries for a workspace directory.
 */
export class ListDirTool extends BaseTool {
  override readonly name = "list_dir";
  override readonly description = "List entries in a workspace directory.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path." },
      },
    },
  };

  constructor(private workspace: string) {
    super();
  }

  /**
   * Returns a tab-separated listing of files and directories.
   */
  async execute(args: Record<string, unknown>): Promise<string> {
    const rel =
      typeof args.path === "string" && args.path.trim() ? args.path : ".";
    const target = resolveWorkspacePath(this.workspace, rel);
    assertIsDirectory(target);
    const entries = readdirSync(target).map((name) =>
      describeEntry(this.workspace, path.join(target, name)),
    );
    return entries.join("\n");
  }
}
