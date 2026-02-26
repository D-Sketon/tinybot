import type { SpawnRequest, SubagentManager } from "../subagent.ts";
import type { ToolSchema } from "./base.ts";
import { asOptionalString, BaseTool } from "./base.ts";

interface SpawnArgs {
  task: string;
  label?: string;
  channel?: string;
  chatId?: string;
}

/**
 * Spawns background subagent tasks through the subagent manager.
 */
export class SpawnTool extends BaseTool {
  override readonly name = "spawn_subagent";
  override readonly description =
    "Spawn a background subagent to work on a long-running or parallel task.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Detailed instructions for the subagent.",
        },
        label: {
          type: "string",
          description: "Optional short label for tracking.",
        },
        channel: {
          type: "string",
          description: "Channel to deliver the completion summary.",
        },
        chatId: {
          type: "string",
          description: "Chat identifier to deliver the completion summary.",
        },
      },
      required: ["task"],
    },
  };

  private defaultChannel = "cli";
  private defaultChatId = "direct";

  constructor(private readonly subagents: SubagentManager) {
    super();
  }

  /**
   * Sets fallback destination for subagent completion notifications.
   */
  setDefaultTarget(channel: string, chatId: string): void {
    if (channel) this.defaultChannel = channel;
    if (chatId) this.defaultChatId = chatId;
  }

  /**
   * Validates spawn arguments and starts a subagent task.
   */
  async execute(rawArgs: Record<string, unknown>): Promise<string> {
    const task = asOptionalString(rawArgs.task);
    if (!task?.trim()) {
      throw new Error("task must be provided");
    }

    const args: SpawnArgs = {
      task,
      label: asOptionalString(rawArgs.label),
      channel: asOptionalString(rawArgs.channel),
      chatId: asOptionalString(rawArgs.chatId),
    };

    const request: SpawnRequest = {
      task: args.task,
      label: args.label,
      originChannel: args.channel ?? this.defaultChannel,
      originChatId: args.chatId ?? this.defaultChatId,
    };
    return this.subagents.spawn(request);
  }
}
