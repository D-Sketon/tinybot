import type { CronExpressionOptions } from "cron-parser";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { consola } from "consola";
import CronParser from "cron-parser";

export type CronKind = "at" | "every" | "cron";

export interface CronSchedule {
  kind: CronKind;
  /** Timestamp in milliseconds for one-shot jobs */
  atMs?: number | null;
  /** Interval in milliseconds for recurring jobs */
  everyMs?: number | null;
  /** Cron expression (5-field) */
  expr?: string | null;
  /** Optional IANA timezone */
  tz?: string | null;
}

export type CronPayloadKind = "system_event" | "agent_turn";

export interface CronPayload {
  kind?: CronPayloadKind;
  message: string;
  deliver?: boolean;
  channel?: string | null;
  to?: string | null;
}

export interface CronJobState {
  nextRunAtMs?: number | null;
  lastRunAtMs?: number | null;
  lastStatus?: "ok" | "error" | "skipped" | null;
  lastError?: string | null;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun?: boolean;
}

export interface CronStore {
  version: number;
  jobs: CronJob[];
}

export type CronJobHandler = (job: CronJob) => Promise<void>;

const STORE_VERSION = 1;

const nowMs = (): number => Date.now();

/**
 * Computes the next execution timestamp for a schedule from a reference time.
 */
function computeNextRun(
  schedule: CronSchedule,
  referenceMs = nowMs(),
): number | null {
  if (schedule.kind === "at") {
    const target = schedule.atMs ?? null;
    return target && target > referenceMs ? target : null;
  }

  if (schedule.kind === "every") {
    const interval = schedule.everyMs ?? null;
    if (!interval || interval <= 0) return null;
    return referenceMs + interval;
  }

  if (schedule.kind === "cron" && schedule.expr) {
    try {
      const options: CronExpressionOptions = {
        currentDate: new Date(referenceMs + 1000),
      };
      if (schedule.tz) {
        options.tz = schedule.tz;
      }
      const iterator = CronParser.parse(schedule.expr, options);
      return iterator.next().getTime();
    } catch (error) {
      consola.warn(
        `Invalid cron expression '${schedule.expr}'${schedule.tz ? ` (tz: ${schedule.tz})` : ""}: ${
          (error as Error).message
        }`,
      );
      return null;
    }
  }

  return null;
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true }).catch(() => {});
}

/**
 * Persists and executes scheduled cron jobs for one-off and recurring triggers.
 */
export class CronService {
  private readonly onJob?: CronJobHandler;
  private store: CronStore | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storePath: string,
    handler?: CronJobHandler,
  ) {
    this.onJob = handler;
  }

  /**
   * Loads jobs from storage and starts the scheduler timer.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.loadStore();
    this.recomputeNextRuns();
    await this.saveStore();
    this.armTimer();
    consola.info(`Cron service ready (${this.store?.jobs.length ?? 0} jobs)`);
  }

  /**
   * Stops scheduling and clears any pending wake-up timer.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Returns scheduled jobs, optionally including disabled entries.
   */
  async listJobs(includeDisabled = false): Promise<CronJob[]> {
    const store = await this.loadStore();
    return store.jobs
      .filter((job) => includeDisabled || job.enabled)
      .sort((a, b) => {
        const aNext = a.state.nextRunAtMs ?? Number.POSITIVE_INFINITY;
        const bNext = b.state.nextRunAtMs ?? Number.POSITIVE_INFINITY;
        return aNext - bNext;
      });
  }

  /**
   * Adds a new scheduled job and arms the scheduler for its next run.
   */
  async addJob(options: {
    name: string;
    schedule: CronSchedule;
    message: string;
    deliver?: boolean;
    channel?: string | null;
    to?: string | null;
    deleteAfterRun?: boolean;
  }): Promise<CronJob> {
    const store = await this.loadStore();
    const timestamp = nowMs();
    const job: CronJob = {
      id: randomUUID().slice(0, 8),
      name: options.name,
      enabled: true,
      schedule: options.schedule,
      payload: {
        kind: "agent_turn",
        message: options.message,
        deliver: options.deliver ?? false,
        channel: options.channel ?? null,
        to: options.to ?? null,
      },
      state: {
        nextRunAtMs: computeNextRun(options.schedule, timestamp),
      },
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      deleteAfterRun: options.deleteAfterRun ?? false,
    };

    store.jobs.push(job);
    await this.saveStore();
    this.armTimer();
    return job;
  }

  /**
   * Removes a scheduled job by id.
   */
  async removeJob(jobId: string): Promise<boolean> {
    const store = await this.loadStore();
    const originalLength = store.jobs.length;
    store.jobs = store.jobs.filter((job) => job.id !== jobId);
    const removed = store.jobs.length < originalLength;
    if (removed) {
      await this.saveStore();
      this.armTimer();
    }
    return removed;
  }

  /**
   * Enables or disables a job and updates its next run state.
   */
  async enableJob(jobId: string, enabled = true): Promise<CronJob | null> {
    const store = await this.loadStore();
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    job.enabled = enabled;
    job.updatedAtMs = nowMs();
    job.state.nextRunAtMs = enabled ? computeNextRun(job.schedule) : null;
    await this.saveStore();
    this.armTimer();
    return job;
  }

  /**
   * Executes a job immediately and refreshes scheduler state.
   */
  async runJob(jobId: string): Promise<boolean> {
    const store = await this.loadStore();
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    await this.executeJob(job);
    await this.saveStore();
    this.armTimer();
    return true;
  }

  /**
   * Returns runtime scheduler status and next wake-up timestamp.
   */
  status(): { enabled: boolean; jobs: number; nextWakeAtMs: number | null } {
    return {
      enabled: this.running,
      jobs: this.store?.jobs.length ?? 0,
      nextWakeAtMs: this.getNextWakeMs(),
    };
  }

  private async loadStore(): Promise<CronStore> {
    if (this.store) {
      return this.store;
    }

    try {
      const text = await readFile(this.storePath, "utf8");
      const data = JSON.parse(text) as Partial<CronStore>;
      this.store = {
        version: data.version ?? STORE_VERSION,
        jobs: (data.jobs ?? []).map((job) => ({
          id: job.id,
          name: job.name,
          enabled: job.enabled ?? true,
          schedule: {
            kind: job.schedule.kind,
            atMs: job.schedule.atMs ?? null,
            everyMs: job.schedule.everyMs ?? null,
            expr: job.schedule.expr ?? null,
            tz: job.schedule.tz ?? null,
          },
          payload: {
            kind: job.payload.kind ?? "agent_turn",
            message: job.payload.message ?? "",
            deliver: job.payload.deliver ?? false,
            channel: job.payload.channel ?? null,
            to: job.payload.to ?? null,
          },
          state: {
            nextRunAtMs: job.state.nextRunAtMs ?? null,
            lastRunAtMs: job.state.lastRunAtMs ?? null,
            lastStatus: job.state.lastStatus ?? null,
            lastError: job.state.lastError ?? null,
          },
          createdAtMs: job.createdAtMs ?? nowMs(),
          updatedAtMs: job.updatedAtMs ?? nowMs(),
          deleteAfterRun: job.deleteAfterRun ?? false,
        })),
      };
    } catch {
      this.store = { version: STORE_VERSION, jobs: [] };
    }

    return this.store;
  }

  private async saveStore(): Promise<void> {
    if (!this.store) return;
    await ensureDir(this.storePath);
    const payload = JSON.stringify(this.store, null, 2);
    await writeFile(this.storePath, payload, "utf8");
  }

  private recomputeNextRuns(): void {
    if (!this.store) return;
    const reference = nowMs();
    for (const job of this.store.jobs) {
      job.state.nextRunAtMs = job.enabled
        ? computeNextRun(job.schedule, reference)
        : null;
    }
  }

  private getNextWakeMs(): number | null {
    if (!this.store) return null;
    const times = this.store.jobs
      .filter((job) => job.enabled && job.state.nextRunAtMs)
      .map((job) => job.state.nextRunAtMs as number);
    return times.length ? Math.min(...times) : null;
  }

  private armTimer(): void {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const nextWake = this.getNextWakeMs();
    if (!nextWake) return;
    const delay = Math.max(0, nextWake - nowMs());
    this.timer = setTimeout(() => {
      this.onTimer();
    }, delay);
  }

  private async onTimer(): Promise<void> {
    if (!this.store || !this.running) {
      return;
    }
    const reference = nowMs();
    const dueJobs = this.store.jobs.filter(
      (job) =>
        job.enabled &&
        job.state.nextRunAtMs !== null &&
        reference >= (job.state.nextRunAtMs ?? 0),
    );
    for (const job of dueJobs) {
      await this.executeJob(job);
    }
    await this.saveStore();
    this.armTimer();
  }

  private async executeJob(job: CronJob): Promise<void> {
    const startedAt = nowMs();
    try {
      if (this.onJob) {
        await this.onJob(job);
      }
      job.state.lastStatus = "ok";
      job.state.lastError = null;
    } catch (error) {
      job.state.lastStatus = "error";
      job.state.lastError = (error as Error).message;
      consola.warn(
        `Cron job '${job.name}' failed: ${(error as Error).message}`,
      );
    }

    job.state.lastRunAtMs = startedAt;
    job.updatedAtMs = nowMs();

    if (job.schedule.kind === "at") {
      if (job.deleteAfterRun) {
        this.store!.jobs = this.store!.jobs.filter(
          (candidate) => candidate.id !== job.id,
        );
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = null;
      }
      return;
    }

    job.state.nextRunAtMs = computeNextRun(job.schedule, nowMs());
  }
}
