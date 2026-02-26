import type { TinybotConfig, WebhookChannelConfig } from "../config/types.ts";
import type { MessageBus } from "../core/bus.ts";
import { attachCliChannel } from "./cli.ts";
import { WebhookChannel } from "./webhook.ts";

export type ChannelStatusFlag = "ready" | "disabled" | "unknown" | "error";

export interface ChannelStatusRow {
  name: string;
  enabled: boolean;
  status: ChannelStatusFlag;
  details: string;
  healthUrl?: string;
}

export interface ChannelRuntimeStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  details?: string;
}

/**
 * Manages startup, shutdown, and status inspection for runtime channels.
 */
export class ChannelManager {
  private webhook?: WebhookChannel;
  private cliAttached = false;
  private allowedChannels?: Set<string>;

  constructor(
    private readonly bus: MessageBus,
    private readonly config: TinybotConfig,
  ) {}

  /**
   * Starts enabled channels, optionally restricted to a provided channel list.
   */
  async start(onlyChannels?: string[]): Promise<void> {
    this.allowedChannels = onlyChannels?.length
      ? new Set(onlyChannels)
      : undefined;
    this.ensureCliChannel();
    await this.ensureWebhookChannel();
  }

  /**
   * Stops all running managed channels.
   */
  async stop(): Promise<void> {
    await this.webhook?.stop();
  }

  /**
   * Builds channel status rows from static config and health checks.
   */
  static async inspectStatus(
    config: TinybotConfig,
  ): Promise<ChannelStatusRow[]> {
    const cli = this.inspectCliStatus(config);
    const webhook = await this.inspectWebhookStatus(config.channels?.webhook);
    return [cli, webhook];
  }

  /**
   * Returns current runtime status of each managed channel.
   */
  getRuntimeStatus(): ChannelRuntimeStatus[] {
    return [
      {
        name: "cli",
        enabled: this.config.channels?.cli?.enabled !== false,
        running: this.cliAttached,
        details: this.cliAttached ? "stdout" : undefined,
      },
      {
        name: "webhook",
        enabled: Boolean(this.config.channels?.webhook?.enabled),
        running: Boolean(this.webhook?.isRunning()),
        details: this.webhook?.describe() ?? undefined,
      },
    ];
  }

  private channelAllowed(name: string): boolean {
    if (!this.allowedChannels) return true;
    return this.allowedChannels.has(name);
  }

  private static inspectCliStatus(config: TinybotConfig): ChannelStatusRow {
    const enabled = config.channels?.cli?.enabled !== false;
    return {
      name: "cli",
      enabled,
      status: enabled ? "ready" : "disabled",
      details: enabled
        ? "Stdout bridge active when agent runs"
        : "Disabled via config",
    };
  }

  private static async inspectWebhookStatus(
    config?: WebhookChannelConfig,
  ): Promise<ChannelStatusRow> {
    if (!config?.enabled) {
      return {
        name: "webhook",
        enabled: false,
        status: "disabled",
        details: "Disabled via config",
      };
    }
    const url = this.resolveWebhookHealthUrl(config);
    const check = await this.checkHealth(url, config.secret);
    return {
      name: "webhook",
      enabled: true,
      status: check.ok ? "ready" : "error",
      details: check.message,
      healthUrl: url,
    };
  }

  private static resolveWebhookHealthUrl(config: WebhookChannelConfig): string {
    if (config.healthUrl) return config.healthUrl;
    const host =
      config.host === "0.0.0.0" ? "127.0.0.1" : (config.host ?? "127.0.0.1");
    const port = config.port ?? 18790;
    return `http://${host}:${port}/health`;
  }

  private static async checkHealth(
    url: string,
    secret?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: secret ? { "x-tinybot-secret": secret } : undefined,
      });
      if (!response.ok) {
        return { ok: false, message: `HTTP ${response.status}` };
      }
      return { ok: true, message: "Healthy" };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private ensureCliChannel(): void {
    const cliEnabled = this.config.channels?.cli?.enabled !== false;
    if (!cliEnabled || this.cliAttached || !this.channelAllowed("cli")) {
      return;
    }
    attachCliChannel(this.bus, {
      verbose: this.config.channels?.cli?.verbose,
    });
    this.cliAttached = true;
  }

  private async ensureWebhookChannel(): Promise<void> {
    const webhookConfig = this.config.channels?.webhook;
    if (!webhookConfig?.enabled || !this.channelAllowed("webhook")) {
      await this.webhook?.stop();
      this.webhook = undefined;
      return;
    }

    if (!this.webhook) {
      this.webhook = new WebhookChannel(this.bus, {
        port: webhookConfig.port ?? 18790,
        host: webhookConfig.host ?? "0.0.0.0",
        secret: webhookConfig.secret,
        waitTimeoutMs: webhookConfig.waitTimeoutMs ?? 15_000,
      });
    }

    await this.webhook.start();
  }
}
