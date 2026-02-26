import type { MessageBus, OutboundMessage } from "../bus.ts";
import type { ToolSchema } from "./base.ts";
import { asOptionalString, asOptionalStringArray, BaseTool } from "./base.ts";

interface MessageArgs {
  content: string;
  channel?: string;
  chatId?: string;
  replyTo?: string;
  media?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Publishes proactive outbound messages to the message bus.
 */
export class MessageTool extends BaseTool {
  override readonly name = "message";
  override readonly description =
    "Send a proactive message via any configured channel.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message text to deliver." },
        channel: { type: "string", description: "Override target channel." },
        chatId: {
          type: "string",
          description: "Override target chat identifier.",
        },
        replyTo: {
          type: "string",
          description: "Optional reply-to message identifier.",
        },
        media: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of media references to attach.",
        },
        metadata: {
          type: "object",
          description: "Structured metadata forwarded to the channel adapter.",
        },
      },
      required: ["content"],
    },
  };

  private defaultChannel = "cli";
  private defaultChatId = "direct";

  constructor(private readonly bus: MessageBus) {
    super();
  }

  /**
   * Sets fallback channel and chat target for outgoing messages.
   */
  setDefaultTarget(channel: string, chatId: string): void {
    if (channel) this.defaultChannel = channel;
    if (chatId) this.defaultChatId = chatId;
  }

  /**
   * Validates payload and queues an outbound message.
   */
  async execute(rawArgs: Record<string, unknown>): Promise<string> {
    const args: MessageArgs = {
      content: asOptionalString(rawArgs.content) ?? "",
      channel: asOptionalString(rawArgs.channel),
      chatId: asOptionalString(rawArgs.chatId),
      replyTo: asOptionalString(rawArgs.replyTo),
      media: asOptionalStringArray(rawArgs.media),
      metadata:
        typeof rawArgs.metadata === "object" && rawArgs.metadata !== null
          ? (rawArgs.metadata as Record<string, unknown>)
          : undefined,
    };

    if (!args.content.trim()) {
      throw new Error("content must not be empty");
    }

    const channel = args.channel ?? this.defaultChannel;
    const chatId = args.chatId ?? this.defaultChatId;
    if (!channel || !chatId) {
      throw new Error("Unable to determine target channel/chatId");
    }

    const outbound: OutboundMessage = {
      channel,
      chatId,
      content: args.content,
      media: args.media,
      replyTo: args.replyTo,
      metadata: args.metadata,
    };

    await this.bus.publishOutbound(outbound);
    return `Queued message to ${channel}:${chatId}`;
  }
}
