import type { MessageBus } from "../bus.ts";
import type { SessionManager } from "../session.ts";
import type { ToolSchema } from "./base.ts";
import { asOptionalString, BaseTool } from "./base.ts";

function trimMessage(message: string, max = 220): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "(empty)";
  return normalized.length > max
    ? `${normalized.slice(0, max - 3)}...`
    : normalized;
}

function parseSessionTarget(value: string): {
  channel: string;
  chatId: string;
} {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("'to' must be formatted as 'channel:chatId'");
  }

  const channel = value.slice(0, separator).trim();
  const chatId = value.slice(separator + 1).trim();
  if (!channel || !chatId) {
    throw new Error("'to' must include both channel and chatId");
  }
  return { channel, chatId };
}

/**
 * Lists known sessions so the model can discover other agent contexts.
 */
export class SessionsListTool extends BaseTool {
  override readonly name = "sessions_list";
  override readonly description =
    "List known sessions (agent contexts) for agent-to-agent coordination.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  };

  constructor(private readonly sessions: SessionManager) {
    super();
  }

  async execute(): Promise<string> {
    const rows = await this.sessions.listSessions();
    if (!rows.length) {
      return "No sessions found.";
    }

    return rows
      .map(
        (row) =>
          `- ${row.id} (messages: ${row.messageCount}, updated: ${row.updatedAt})`,
      )
      .join("\n");
  }
}

/**
 * Reads recent messages from a specific session for coordination context.
 */
export class SessionsHistoryTool extends BaseTool {
  override readonly name = "sessions_history";
  override readonly description =
    "Read recent message history from a specific session (channel:chatId).";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Target session id in format channel:chatId.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of recent messages to return (default 20).",
        },
      },
      required: ["sessionId"],
    },
  };

  constructor(private readonly sessions: SessionManager) {
    super();
  }

  async execute(rawArgs: Record<string, unknown>): Promise<string> {
    const sessionId = asOptionalString(rawArgs.sessionId)?.trim();
    const rawLimit = rawArgs.limit;
    if (!sessionId) {
      throw new Error("sessionId must be provided");
    }
    const limit =
      typeof rawLimit === "number" && Number.isFinite(rawLimit)
        ? Math.max(1, Math.floor(rawLimit))
        : 20;

    const history = await this.sessions.getHistory(sessionId, limit);
    if (history === null) {
      return `Session ${sessionId} not found.`;
    }
    if (!history.length) {
      return `Session ${sessionId} has no messages yet.`;
    }

    const formatted = history
      .map((message, index) => {
        const role = message.role;
        return `${index + 1}. [${role}] ${trimMessage(message.content as string)}`;
      })
      .join("\n");

    return `Recent history for ${sessionId}:\n${formatted}`;
  }
}

/**
 * Sends an instruction to another session by publishing a synthetic inbound turn.
 */
export class SessionsSendTool extends BaseTool {
  override readonly name = "sessions_send";
  override readonly description =
    "Send a message to another session (channel:chatId) for agent-to-agent delegation.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Destination session id in format channel:chatId.",
        },
        content: {
          type: "string",
          description: "Task or instruction to send.",
        },
        senderId: {
          type: "string",
          description: "Optional sender id label (default: agent).",
        },
        replyBack: {
          type: "boolean",
          description:
            "When true, destination session reply is forwarded back to current session.",
        },
      },
      required: ["to", "content"],
    },
  };

  private originChannel = "cli";
  private originChatId = "direct";

  constructor(private readonly bus: MessageBus) {
    super();
  }

  setOrigin(channel: string, chatId: string): void {
    if (channel) this.originChannel = channel;
    if (chatId) this.originChatId = chatId;
  }

  async execute(rawArgs: Record<string, unknown>): Promise<string> {
    const to = asOptionalString(rawArgs.to)?.trim();
    const content = asOptionalString(rawArgs.content)?.trim();
    const senderId = asOptionalString(rawArgs.senderId)?.trim() || "agent";
    const replyBack = rawArgs.replyBack === true;

    if (!to) {
      throw new Error("to must be provided");
    }
    if (!content) {
      throw new Error("content must not be empty");
    }

    const target = parseSessionTarget(to);

    const metadata: Record<string, unknown> = {
      originChannel: this.originChannel,
      originChatId: this.originChatId,
      routedBy: "sessions_send",
    };
    if (replyBack) {
      metadata.replyBackTo = {
        channel: this.originChannel,
        chatId: this.originChatId,
      };
    }

    await this.bus.publishInbound({
      channel: target.channel,
      chatId: target.chatId,
      senderId,
      content,
      metadata,
    });

    return `Sent message to ${target.channel}:${target.chatId}${replyBack ? " (reply-back enabled)" : ""}`;
  }
}
