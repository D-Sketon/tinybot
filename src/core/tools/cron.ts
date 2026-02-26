import type { CronSchedule, CronService } from "../cron.ts";
import type { ToolSchema } from "./base.ts";
import { BaseTool } from "./base.ts";

interface CronToolArgs {
  action: "add" | "list" | "remove";
  message?: string;
  jobId?: string;
  everySeconds?: number;
  cronExpr?: string;
  at?: string;
}

function formatTimestamp(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString() : "(unscheduled)";
}

/**
 * Exposes scheduling operations for creating, listing, and removing cron jobs.
 */
export class CronTool extends BaseTool {
  override readonly name = "cron";
  override readonly description =
    "List or manage scheduled jobs (add/list/remove).";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "list", "remove"],
          description: "Operation to perform.",
        },
        message: {
          type: "string",
          description: "Reminder message for new jobs.",
        },
        everySeconds: {
          type: "number",
          description: "Interval in seconds for recurring jobs.",
        },
        cronExpr: {
          type: "string",
          description: "Cron expression (5 fields) for advanced schedules.",
        },
        at: {
          type: "string",
          description: "ISO-8601 timestamp for one-off jobs.",
        },
        jobId: {
          type: "string",
          description: "Target job id (for remove).",
        },
      },
      required: ["action"],
    },
  };

  private defaultChannel = "cron";
  private defaultChatId = "cron";

  constructor(private readonly cron: CronService) {
    super();
  }

  /**
   * Sets default channel context for jobs created from the current conversation.
   */
  setContext(channel: string, chatId: string): void {
    if (channel) this.defaultChannel = channel;
    if (chatId) this.defaultChatId = chatId;
  }

  /**
   * Executes the requested cron management action.
   */
  async execute(rawArgs: Record<string, unknown>): Promise<string> {
    const args = rawArgs as unknown as CronToolArgs;
    if (args.action === "add") return this.addJob(args);
    if (args.action === "list") return this.listJobs();
    if (args.action === "remove") return this.removeJob(args.jobId);
    throw new Error(`Unsupported action: ${args.action}`);
  }

  private async addJob(args: CronToolArgs): Promise<string> {
    const message = args.message?.trim();
    if (!message) {
      throw new Error("message is required to add a job");
    }
    const schedule = this.buildSchedule(args);
    if (!schedule) {
      throw new Error(
        "Provide either everySeconds, cronExpr, or at to define the schedule",
      );
    }

    const channel = this.defaultChannel;
    const chatId = this.defaultChatId;
    if (!channel || !chatId) {
      throw new Error("Cannot add job without a channel/chat context");
    }

    const name = message.slice(0, 48);
    const job = await this.cron.addJob({
      name,
      schedule,
      message,
      deliver: true,
      channel,
      to: chatId,
      deleteAfterRun: schedule.kind === "at",
    });

    const nextRun = formatTimestamp(job.state.nextRunAtMs);
    return `Scheduled job '${job.name}' (id: ${job.id}), next run: ${nextRun}`;
  }

  private async listJobs(): Promise<string> {
    const jobs = await this.cron.listJobs(false);
    if (!jobs.length) return "No active jobs.";
    return jobs
      .map((job) => {
        const status = job.enabled ? "enabled" : "disabled";
        return `- ${job.name} (id: ${job.id}, ${job.schedule.kind}, ${status}, next: ${formatTimestamp(job.state.nextRunAtMs)})`;
      })
      .join("\n");
  }

  private async removeJob(jobId?: string): Promise<string> {
    if (!jobId) {
      throw new Error("jobId is required to remove a job");
    }
    const removed = await this.cron.removeJob(jobId);
    return removed ? `Removed job ${jobId}` : `Job ${jobId} not found`;
  }

  private buildSchedule(args: CronToolArgs): CronSchedule | null {
    if (typeof args.everySeconds === "number" && args.everySeconds > 0) {
      return {
        kind: "every",
        everyMs: args.everySeconds * 1000,
      } satisfies CronSchedule;
    }
    if (typeof args.cronExpr === "string" && args.cronExpr.trim()) {
      return {
        kind: "cron",
        expr: args.cronExpr.trim(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      } satisfies CronSchedule;
    }
    if (typeof args.at === "string" && args.at.trim()) {
      const timestamp = Date.parse(args.at);
      if (Number.isNaN(timestamp))
        throw new Error("Invalid ISO timestamp for 'at'");
      return { kind: "at", atMs: timestamp } satisfies CronSchedule;
    }
    return null;
  }
}
