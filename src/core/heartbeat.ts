import { readFile } from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";

export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30 * 60;
export const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your workspace (if it exists).
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: HEARTBEAT_OK`;
const HEARTBEAT_READ_TIMEOUT_MS = 2000;

const SKIP_PATTERNS = new Set(
  ["- [ ]", "* [ ]", "- [x]", "* [x]"].map((value) => value.toLowerCase()),
);

export interface HeartbeatOptions {
  workspace: string;
  intervalSeconds?: number;
  enabled?: boolean;
  onHeartbeat?: (prompt: string) => Promise<void>;
}

/**
 * Determines whether HEARTBEAT content has actionable items.
 */
function isHeartbeatEmpty(content: string | null): boolean {
  if (!content) return true;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--")) continue;
    if (SKIP_PATTERNS.has(line.toLowerCase())) continue;
    return false;
  }
  return true;
}

/**
 * Periodically checks HEARTBEAT instructions and triggers automated follow-up.
 */
export class HeartbeatService {
  private readonly workspace: string;
  private readonly intervalSeconds: number;
  private readonly enabled: boolean;
  private readonly onHeartbeat?: (prompt: string) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: HeartbeatOptions) {
    this.workspace = options.workspace;
    this.intervalSeconds =
      options.intervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
    this.enabled = options.enabled ?? true;
    this.onHeartbeat = options.onHeartbeat;
  }

  get heartbeatFile(): string {
    return path.join(this.workspace, "HEARTBEAT.md");
  }

  /**
   * Starts the heartbeat timer and performs an immediate first check.
   */
  async start(): Promise<void> {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalSeconds * 1000);
    // Check once right away so we don't wait a full interval.
    this.tick();
    consola.info(`Heartbeat service ready (every ${this.intervalSeconds}s)`);
  }

  /**
   * Stops heartbeat checks and clears the active interval.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async readHeartbeatFile(): Promise<string | null> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const timer = new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Heartbeat read timeout")),
          HEARTBEAT_READ_TIMEOUT_MS,
        );
      });
      const content = await Promise.race([
        readFile(this.heartbeatFile, "utf8"),
        timer,
      ]);
      return content as string;
    } catch {
      return null;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const content = await this.readHeartbeatFile();
    if (isHeartbeatEmpty(content)) {
      return;
    }

    if (!this.onHeartbeat) {
      return;
    }

    try {
      await this.onHeartbeat(HEARTBEAT_PROMPT);
    } catch (error) {
      consola.warn(`Heartbeat execution failed: ${(error as Error).message}`);
    }
  }
}
