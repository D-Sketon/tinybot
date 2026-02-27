import type { ExecOptions, TinybotConfig } from "../config/types.ts";
import type { InboundMessage, MessageBus } from "./bus.ts";
import type { AgentMessage } from "./context.ts";
import type { CronJob } from "./cron.ts";
import type { Provider } from "./provider.ts";
import path from "node:path";
import process from "node:process";
import { consola } from "consola";
import { ContextBuilder } from "./context.ts";
import { CronService } from "./cron.ts";
import { HeartbeatService } from "./heartbeat.ts";
import { MemoryStore } from "./memory.ts";
import { createProvider } from "./provider.ts";
import { SessionManager } from "./session.ts";
import { buildWorkspaceTools, loop } from "./shared.ts";
import { SkillsStore } from "./skills.ts";
import { SubagentManager } from "./subagent.ts";
import { CronTool } from "./tools/cron.ts";
import { MessageTool } from "./tools/message.ts";
import { ToolRegistry } from "./tools/registry.ts";
import {
  SessionsHistoryTool,
  SessionsListTool,
  SessionsSendTool,
} from "./tools/sessions.ts";
import { SpawnTool } from "./tools/spawn.ts";

/**
 * Coordinates message processing, tool execution, sessions, and automation services.
 */
export class TinybotAgent {
  private readonly workspace: string;
  private readonly execOptions: ExecOptions;
  private readonly context: ContextBuilder;
  private readonly memory: MemoryStore;
  private readonly skills: SkillsStore;
  private readonly sessions: SessionManager;
  private readonly provider: Provider;
  private readonly tools = new ToolRegistry();
  private readonly subagents: SubagentManager;
  private readonly spawnTool: SpawnTool;
  private readonly messageTool: MessageTool;
  private readonly sessionsSendTool: SessionsSendTool;
  private cronService?: CronService;
  private cronTool?: CronTool;
  private heartbeatService?: HeartbeatService;
  private running = false;

  private static isReplyBackTarget(
    value: unknown,
  ): value is { channel: string; chatId: string } {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.channel === "string" &&
      candidate.channel.trim().length > 0 &&
      typeof candidate.chatId === "string" &&
      candidate.chatId.trim().length > 0
    );
  }

  constructor(
    readonly bus: MessageBus,
    readonly config: TinybotConfig,
  ) {
    this.workspace = this.config.workspace ?? "./workspace";
    this.execOptions = this.config.exec ?? {
      timeout: 5000,
      restrictToWorkspace: true,
    };
    this.context = new ContextBuilder(this.workspace);
    this.memory = new MemoryStore(this.workspace);
    this.skills = new SkillsStore(
      this.workspace,
      this.resolveBuiltinSkillsPath(),
    );
    this.sessions = new SessionManager(this.workspace);
    this.provider = createProvider(this.config);
    this.subagents = new SubagentManager({
      provider: this.provider,
      workspace: this.workspace,
      bus: this.bus,
      execOptions: this.execOptions,
      maxIterations: this.config.maxToolIterations,
      webOptions: {
        maxResults: this.config.tools?.web?.maxResults,
      },
    });
    this.spawnTool = new SpawnTool(this.subagents);
    this.messageTool = new MessageTool(this.bus);
    this.sessionsSendTool = new SessionsSendTool(this.bus);
    buildWorkspaceTools({
      workspace: this.context.workspacePath,
      execOptions: this.execOptions,
      webOptions: {
        maxResults: this.config.tools?.web?.maxResults,
      },
      extras: [
        this.spawnTool,
        this.messageTool,
        new SessionsListTool(this.sessions),
        new SessionsHistoryTool(this.sessions),
        this.sessionsSendTool,
      ],
      registry: this.tools,
    });
    this.initializeAutomation();
  }

  /**
   * Starts background services and begins consuming inbound messages.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    consola.log(
      "tinybot agent starting with workspace",
      this.context.workspacePath,
    );
    await this.cronService?.start();
    await this.heartbeatService?.start();
    this.bus.dispatchOutbound();
    this.runLoop();
  }

  /**
   * Stops the agent loop and all managed background services.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.cronService?.stop();
    this.heartbeatService?.stop();
    this.bus.stopDispatch();
    consola.log("tinybot agent has stopped");
  }

  /**
   * Continuously consumes inbound messages while the agent is running.
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const inbound = await this.bus.consumeInbound();
        if (!this.running) break;
        if (!inbound) {
          continue;
        }
        await this.handleInbound(inbound);
      } catch (error) {
        consola.warn("agent loop error", (error as Error).message);
      }
    }
  }

  private resolveBuiltinSkillsPath(): string | undefined {
    if (process.env.TINYBOT_BUILTIN_SKILLS) {
      return path.resolve(process.env.TINYBOT_BUILTIN_SKILLS);
    }
    return path.join(process.cwd(), "workspace", "skills");
  }

  private initializeAutomation(): void {
    const cronConfig = this.config.cron ?? {};
    if (cronConfig.enabled !== false) {
      const storePath =
        cronConfig.storePath ?? path.join(this.workspace, "cron", "jobs.json");
      this.cronService = new CronService(storePath, async (job) => {
        await this.handleCronJob(job);
      });
      this.cronTool = new CronTool(this.cronService);
      this.tools.register(this.cronTool);
    }

    const heartbeatConfig = this.config.heartbeat ?? {};
    if (heartbeatConfig.enabled !== false) {
      this.heartbeatService = new HeartbeatService({
        workspace: this.workspace,
        intervalSeconds: heartbeatConfig.intervalSeconds,
        enabled: heartbeatConfig.enabled,
        onHeartbeat: async (prompt) => {
          await this.publishSystemInbound("heartbeat", "heartbeat", prompt, {
            origin: "heartbeat",
          });
        },
      });
    }
  }

  /**
   * Handles one inbound message turn and publishes the assistant response.
   */
  private async handleInbound(message: InboundMessage): Promise<void> {
    try {
      this.spawnTool.setDefaultTarget(message.channel, message.chatId);
      this.messageTool.setDefaultTarget(message.channel, message.chatId);
      this.sessionsSendTool.setOrigin(message.channel, message.chatId);
      this.cronTool?.setContext(message.channel, message.chatId);
      const sessionKey = `${message.channel}:${message.chatId}`;
      const session = await this.sessions.getOrCreate(sessionKey);

      const memory = this.memory.getMemoryContext();
      const skills = this.skills.buildSummary();

      const initialMessages = this.context.buildMessages(message.content, {
        history: session.messages,
        media: message.media,
        channel: message.channel,
        chatId: message.chatId,
        memory,
        skills,
      });

      const userMessage = initialMessages[initialMessages.length - 1]!;

      const conversationMessages: AgentMessage[] = [
        ...session.messages,
        userMessage,
      ];

      let streamSequence = 0;
      let streamed = false;
      const onStreamDelta = async (delta: string) => {
        if (!delta) return;
        streamed = true;
        streamSequence += 1;
        await this.bus.publishOutbound({
          channel: message.channel,
          chatId: message.chatId,
          content: delta,
          kind: "delta",
          sequence: streamSequence,
          replyTo: message.metadata?.replyTo as string | undefined,
        });
      };

      const { content } = await loop({
        maxIterations: this.config.maxToolIterations,
        messages: [...initialMessages],
        provider: this.provider,
        tools: this.tools,
        sessionMessages: conversationMessages,
        onStreamDelta,
      });

      // Update and save session
      session.messages = conversationMessages;
      await this.sessions.save(session);

      await this.bus.publishOutbound({
        channel: message.channel,
        chatId: message.chatId,
        content,
        replyTo: message.metadata?.replyTo as string | undefined,
        kind: streamed ? "final" : undefined,
      });

      const replyBackTo =
        message.metadata &&
        TinybotAgent.isReplyBackTarget(
          (message.metadata as Record<string, unknown>).replyBackTo,
        )
          ? ((message.metadata as Record<string, unknown>).replyBackTo as {
              channel: string;
              chatId: string;
            })
          : null;

      if (
        replyBackTo &&
        (replyBackTo.channel !== message.channel ||
          replyBackTo.chatId !== message.chatId)
      ) {
        await this.publishSystemInbound(
          replyBackTo.channel,
          replyBackTo.chatId,
          `[Reply from ${message.channel}:${message.chatId}]\n\n${content}`,
          {
            routedBy: "sessions_send",
            sourceSession: `${message.channel}:${message.chatId}`,
          },
        );
      }
    } catch (error) {
      consola.error("Error processing message:", (error as Error).message);
      await this.bus.publishOutbound({
        channel: message.channel,
        chatId: message.chatId,
        content: `Sorry, I encountered an error: ${(error as Error).message}`,
      });
    }
  }

  /**
   * Publishes a user message into the inbound bus with optional target overrides.
   */
  async enqueueMessage(
    content: string,
    overrides?: Partial<
      Pick<InboundMessage, "channel" | "chatId" | "senderId" | "metadata">
    >,
  ): Promise<void> {
    await this.bus.publishInbound({
      channel: overrides?.channel ?? "cli",
      senderId: overrides?.senderId ?? "user",
      chatId: overrides?.chatId ?? "direct",
      content,
      metadata: overrides?.metadata,
    });
  }

  /**
   * Converts a scheduled cron job payload into an internal system inbound message.
   */
  private async handleCronJob(job: CronJob): Promise<void> {
    const payload = job.payload;
    if (!payload.message) {
      consola.warn(`Cron job ${job.id} has no message payload; skipping.`);
      return;
    }

    const channel = payload.channel ?? "cron";
    const chatId = payload.to ?? channel;

    await this.publishSystemInbound(channel, chatId, payload.message, {
      origin: "cron",
      cronJobId: job.id,
      deliver: payload.deliver ?? false,
      payloadKind: payload.kind ?? "agent_turn",
    });
  }

  /**
   * Publishes a synthetic system-origin message into the inbound queue.
   */
  private async publishSystemInbound(
    channel: string,
    chatId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.bus.publishInbound({
      channel,
      chatId,
      senderId: "system",
      content,
      metadata,
    });
  }
}
