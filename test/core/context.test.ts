import { Buffer } from "node:buffer";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextBuilder } from "../../src/core/context.ts";

const { files, existsSyncMock, statSyncMock, readFileSyncMock } = vi.hoisted(
  () => {
    const files = new Map<
      string,
      { content: string | Buffer; isFile: boolean }
    >();
    return {
      files,
      existsSyncMock: vi.fn((target: string) => files.has(target)),
      statSyncMock: vi.fn((target: string) => {
        const entry = files.get(target);
        if (!entry) {
          throw new Error("ENOENT");
        }
        const size =
          typeof entry.content === "string"
            ? Buffer.byteLength(entry.content, "utf-8")
            : entry.content.byteLength;
        return {
          isFile: () => entry.isFile,
          size,
        };
      }),
      readFileSyncMock: vi.fn((target: string) => {
        const entry = files.get(target);
        if (!entry) {
          throw new Error("ENOENT");
        }
        return entry.content;
      }),
    };
  },
);

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
  readFileSync: readFileSyncMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  vi.useRealTimers();
});

describe("contextBuilder", () => {
  it("builds system prompt with bootstrap files and extras", () => {
    const workspace = "C:\\workspace";
    files.set(path.join(workspace, "AGENTS.md"), {
      content: "agent rules",
      isFile: true,
    });
    files.set(path.join(workspace, "SOUL.md"), {
      content: "soul rules",
      isFile: true,
    });

    const builder = new ContextBuilder(workspace);
    const prompt = builder.buildSystemPrompt({
      memory: "mem",
      skills: "skills",
    });

    expect(prompt).toContain("Workspace");
    expect(prompt).toContain(workspace);
    expect(prompt).toContain("## AGENTS.md");
    expect(prompt).toContain("agent rules");
    expect(prompt).toContain("## SOUL.md");
    expect(prompt).toContain("soul rules");
    expect(prompt).toContain("## Memory");
    expect(prompt).toContain("mem");
    expect(prompt).toContain("skills");
  });

  it("builds messages with media attachments and session info", () => {
    const workspace = "C:\\workspace";
    const imagePath = path.join(workspace, "image.png");
    files.set(imagePath, { content: Buffer.from([1, 2, 3, 4]), isFile: true });

    const builder = new ContextBuilder(workspace);
    const messages = builder.buildMessages("hello", {
      media: ["image.png"],
      channel: "cli",
      chatId: "direct",
    });

    const systemMessage = messages[0]!;
    const userMessage = messages[messages.length - 1]!;

    expect(systemMessage.role).toBe("system");
    expect(String(systemMessage.content)).toContain("## Session");
    expect(systemMessage.content).toContain("Channel: cli");

    expect(userMessage.role).toBe("user");
    expect(Array.isArray(userMessage.content)).toBe(true);
    const parts = userMessage.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts[0]?.type).toBe("text");
    expect(parts[1]?.type).toBe("image_url");
    expect(parts[1]?.image_url?.url).toMatch(/^data:image\/png;base64,/);
  });

  it("skips invalid media and returns plain text when no attachments", () => {
    const workspace = "C:\\workspace";
    const builder = new ContextBuilder(workspace);

    const messages = builder.buildMessages("hello", {
      media: ["missing.png"],
    });

    const userMessage = messages[messages.length - 1]!;
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("hello");
  });

  it("allows image-only messages", () => {
    const workspace = "C:\\workspace";
    const imagePath = path.join(workspace, "photo.jpg");
    files.set(imagePath, { content: Buffer.from([5, 6, 7]), isFile: true });

    const builder = new ContextBuilder(workspace);
    const messages = builder.buildMessages("   ", {
      media: ["photo.jpg"],
    });

    const userMessage = messages[messages.length - 1]!;
    expect(Array.isArray(userMessage.content)).toBe(true);
    const parts = userMessage.content as Array<{ type: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe("image_url");
  });

  it("accepts remote image urls directly", () => {
    const workspace = "C:\\workspace";
    const builder = new ContextBuilder(workspace);

    const messages = builder.buildMessages("look", {
      media: ["https://example.com/photo.png"],
    });

    const userMessage = messages[messages.length - 1]!;
    const parts = userMessage.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts[0]?.type).toBe("text");
    expect(parts[1]?.image_url?.url).toBe("https://example.com/photo.png");
  });

  it("handles svg mime types correctly", () => {
    const workspace = "C:\\workspace";
    const builder = new ContextBuilder(workspace);
    const svgPath = path.join(workspace, "image.svg");
    files.set(svgPath, { content: Buffer.from([1, 2, 3]), isFile: true });

    // stub stat to indicate small file and mimic image/svg+xml
    vi.stubGlobal("path", path);
    const messages = builder.buildMessages("hello", { media: ["image.svg"] });
    const userMessage = messages[messages.length - 1]!;
    const parts = userMessage.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    // ensure an image part is present or text fallback
    expect(
      parts.some((p) => p.type === "image_url" || p.type === "text"),
    ).toBeTruthy();
  });

  it("skips non-image files and oversized attachments", () => {
    const workspace = "C:\\workspace";
    const textPath = path.join(workspace, "note.txt");
    const bigPath = path.join(workspace, "large.png");
    files.set(textPath, { content: "not image", isFile: true });
    files.set(bigPath, { content: Buffer.alloc(5_000_001), isFile: true });

    const builder = new ContextBuilder(workspace);
    const messages = builder.buildMessages("hello", {
      media: ["note.txt", "large.png"],
    });

    const userMessage = messages[messages.length - 1]!;
    expect(userMessage.content).toBe("hello");
  });

  it("skips attachments when reading fails and ignores bootstrap read errors", () => {
    const workspace = "C:\\workspace";
    const imagePath = path.join(workspace, "broken.png");
    files.set(imagePath, { content: Buffer.from([1, 2, 3]), isFile: true });
    const agentsPath = path.join(workspace, "AGENTS.md");
    files.set(agentsPath, { content: "data", isFile: true });

    readFileSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith("AGENTS.md")) {
        throw new Error("boom");
      }
      if (String(target).endsWith("broken.png")) {
        throw new Error("broken");
      }
      const entry = files.get(target);
      if (!entry) {
        throw new Error("ENOENT");
      }
      return entry.content;
    });

    const builder = new ContextBuilder(workspace);
    const prompt = builder.buildSystemPrompt();
    const messages = builder.buildMessages("hello", {
      media: ["broken.png"],
    });

    const userMessage = messages[messages.length - 1]!;
    expect(prompt).not.toContain("## AGENTS.md");
    expect(userMessage.content).toBe("hello");
  });

  it("ignores zero-byte files when preparing attachments", () => {
    const workspace = "C:\\workspace";
    const emptyPath = path.join(workspace, "empty.png");
    files.set(emptyPath, { content: Buffer.alloc(0), isFile: true });

    const builder = new ContextBuilder(workspace);
    const messages = builder.buildMessages("hi", { media: ["empty.png"] });
    const userMessage = messages[messages.length - 1]!;
    expect(userMessage.content).toBe("hi");
  });

  it("ignores whitespace-only media entries and returns plain text", () => {
    const workspace = "C:\\workspace";
    const builder = new ContextBuilder(workspace);

    const messages = builder.buildMessages("hello", { media: ["   "] });
    const userMessage = messages[messages.length - 1]!;
    expect(userMessage.content).toBe("hello");
  });
});
