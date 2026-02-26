import type { ExecOptions } from "../config/types.ts";
import type { MessageBus } from "./bus.ts";
import type { AgentMessage } from "./context.ts";
import type { Provider } from "./provider.ts";
import { randomUUID } from "node:crypto";
import { consola } from "consola";
import { buildWorkspaceTools, loop } from "./shared.ts";
import { ToolRegistry } from "./tools/registry.ts";

interface SubagentOrigin {
  channel: string;
  chatId: string;
}

export interface SpawnRequest {
  task: string;
  label?: string;
  originChannel?: string;
  originChatId?: string;
}

interface SubagentManagerOptions {
  provider: Provider;
  workspace: string;
  bus: MessageBus;
  execOptions: ExecOptions;
  maxIterations?: number;
  webOptions?: {
    maxResults?: number;
  };
}

interface SubagentTaskContext {
  id: string;
  label: string;
  task: string;
  origin: SubagentOrigin;
}

const DEFAULT_MAX_ITERATIONS = 16;

/**
 * Manages detached subagent tasks and reports their outcomes back to the main bus.
 */
export class SubagentManager {
  private readonly provider: Provider;
  private readonly workspace: string;
  private readonly bus: MessageBus;
  private readonly execOptions: ExecOptions;
  private readonly maxIterations: number;
  private readonly webOptions?: SubagentManagerOptions["webOptions"];
  private readonly running = new Map<string, Promise<void>>();

  constructor(options: SubagentManagerOptions) {
    this.provider = options.provider;
    this.workspace = options.workspace;
    this.bus = options.bus;
    this.execOptions = options.execOptions;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.webOptions = options.webOptions;
  }

  /**
   * Starts a background subagent task and returns a tracking message.
   */
  async spawn(request: SpawnRequest): Promise<string> {
    const task = request.task?.trim();
    if (!task) {
      throw new Error("task is required");
    }

    const taskId = randomUUID().slice(0, 8);
    const label = request.label?.trim() || this.deriveLabel(task);
    const origin: SubagentOrigin = {
      channel: request.originChannel?.trim() || "cli",
      chatId: request.originChatId?.trim() || "direct",
    };

    const runner = this.runTask({ id: taskId, label, task, origin })
      .catch((error) => {
        consola.warn(`Subagent ${taskId} failed: ${(error as Error).message}`);
      })
      .finally(() => {
        this.running.delete(taskId);
      });

    this.running.set(taskId, runner);

    return `Subagent '${label}' started (id: ${taskId}). You'll be notified when it completes.`;
  }

  private deriveLabel(task: string): string {
    const trimmed = task.replace(/\s+/g, " ").trim();
    return trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed;
  }

  private buildPrompt(task: string): string {
    return `# Subagent\n\nYou are a focused helper spawned to complete a single task.\n\n## Task\n${task}\n\n## Rules\n- Stay on the task; no side quests.\n- You cannot message the user directly.\n- Finish with a concise summary of what you accomplished.\n\nYou can read/write files in the workspace (${this.workspace}) and execute safe shell commands.`;
  }

  private async runTask(context: SubagentTaskContext): Promise<void> {
    const tools = buildWorkspaceTools({
      workspace: this.workspace,
      execOptions: this.execOptions,
      webOptions: this.webOptions,
      registry: new ToolRegistry(),
    });
    const messages: AgentMessage[] = [
      { role: "system", content: this.buildPrompt(context.task) },
      { role: "user", content: context.task },
    ];

    const { content, status } = await loop({
      maxIterations: this.maxIterations,
      messages,
      provider: this.provider,
      tools,
    });

    await this.announceResult(context, content, status);
  }

  /**
   * Publishes a summarized subagent outcome back into the main inbound queue.
   */
  private async announceResult(
    context: SubagentTaskContext,
    result: string,
    status: "ok" | "error",
  ): Promise<void> {
    const outcome =
      status === "ok" ? "completed successfully" : "encountered an error";
    const content = `[Subagent '${context.label}' ${outcome}]\n\nTask:\n${context.task}\n\nResult:\n${result}\n\nSummarize this outcome for the user in 1-2 sentences. Avoid mentioning internal implementation details.`;

    await this.bus.publishInbound({
      channel: context.origin.channel,
      senderId: "subagent",
      chatId: context.origin.chatId,
      content,
      metadata: {
        subagentId: context.id,
        status,
      },
    });
  }
}
