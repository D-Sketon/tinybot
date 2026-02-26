import type { ToolCall } from "./provider.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type MessageRole = "system" | "user" | "assistant" | "tool";

interface TextContentPart {
  type: "text";
  text: string;
}

interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export type AgentContent = string | Array<TextContentPart | ImageContentPart>;

export interface AgentMessage {
  role: MessageRole;
  content: AgentContent;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
}

export interface ContextOptions {
  history?: AgentMessage[];
  media?: string[];
  channel?: string;
  chatId?: string;
  memory?: string;
  skills?: string;
}

const BOOTSTRAP_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "TOOLS.md",
  "IDENTITY.md",
];

/**
 * Builds system and user messages for a single agent turn.
 */
export class ContextBuilder {
  constructor(public workspacePath: string) {}

  /**
   * Composes the system prompt from identity, workspace docs, memory, and skills.
   */
  buildSystemPrompt(extras?: { memory?: string; skills?: string }): string {
    const workspace = path.resolve(this.workspacePath);
    const now = new Date().toLocaleString();

    const identitySection = `# tinybot

You are tinybot, a Bun-first assistant with access to tools and a sandboxed workspace.

## Workspace
${workspace}

## Timestamp
${now}

Read ${workspace}/AGENTS.md, SOUL.md, USER.md, TOOLS.md, and IDENTITY.md for guidance.`;

    const bootstrap = this.loadBootstrapFiles();
    const memory = extras?.memory ? `## Memory\n\n${extras.memory}` : "";
    const skills = extras?.skills ? extras.skills : "";

    return [identitySection, bootstrap, memory, skills]
      .filter((section) => !!section && section.trim())
      .join("\n\n---\n\n");
  }

  /**
   * Builds the full message list including system context, history, and current user input.
   */
  buildMessages(
    currentMessage: string,
    options: ContextOptions = {},
  ): AgentMessage[] {
    const { history = [], media, channel, chatId, memory, skills } = options;

    const systemMessage: AgentMessage = {
      role: "system",
      content: this.buildSystemPrompt({ memory, skills }),
    };

    if (channel && chatId) {
      systemMessage.content += `\n\n## Session\nChannel: ${channel}\nChat: ${chatId}`;
    }

    const userMessage: AgentMessage = {
      role: "user",
      content: this.buildUserContent(currentMessage, media),
    };

    const messages: AgentMessage[] = [systemMessage, ...history, userMessage];

    return messages;
  }

  private buildUserContent(text: string, media?: string[]): AgentContent {
    const attachments = this.prepareMediaAttachments(media);
    if (!attachments.length) {
      return text;
    }

    const parts: Array<TextContentPart | ImageContentPart> = [];
    if (text.trim()) {
      parts.push({ type: "text", text });
    }
    return [...parts, ...attachments];
  }

  private prepareMediaAttachments(media?: string[]): ImageContentPart[] {
    if (!media?.length) {
      return [];
    }

    const attachments: ImageContentPart[] = [];
    for (const raw of media) {
      const attachment = this.createMediaAttachment(raw);
      if (attachment) {
        attachments.push(attachment);
      }
    }
    return attachments;
  }

  private createMediaAttachment(value: string): ImageContentPart | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return {
        type: "image_url",
        image_url: { url: trimmed },
      };
    }

    const resolved = path.isAbsolute(trimmed)
      ? trimmed
      : path.join(this.workspacePath, trimmed);
    if (!existsSync(resolved)) {
      return null;
    }

    let stats;
    try {
      stats = statSync(resolved);
    } catch {
      return null;
    }

    const MAX_MEDIA_BYTES = 5_000_000;
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_MEDIA_BYTES) {
      return null;
    }

    const mime = this.guessMimeType(resolved);
    if (!mime || !mime.startsWith("image/")) {
      return null;
    }

    try {
      const buffer = readFileSync(resolved);
      const base64 = buffer.toString("base64");
      return {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${base64}` },
      };
    } catch {
      return null;
    }
  }

  private guessMimeType(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    const mapping: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".heic": "image/heic",
      ".heif": "image/heif",
    };
    return mapping[ext] ?? null;
  }

  private loadBootstrapFiles(): string {
    const parts: string[] = [];

    for (const filename of BOOTSTRAP_FILES) {
      const filePath = path.join(this.workspacePath, filename);
      if (!existsSync(filePath)) {
        continue;
      }
      try {
        const contents = readFileSync(filePath, "utf-8");
        if (contents.trim()) {
          parts.push(`## ${filename}\n\n${contents.trim()}`);
        }
      } catch {
        // ignore read errors while scaffolding
      }
    }

    return parts.join("\n\n");
  }
}
