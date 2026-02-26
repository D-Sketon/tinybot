import process from "node:process";
import { consola } from "consola";
import { ChannelManager } from "../channels/manager.ts";
import { loadConfig } from "../config/loader.ts";
import { TinybotAgent } from "../core/agent.ts";
import { MessageBus } from "../core/bus.ts";

export interface GatewayArgs {
  config?: string;
  channels?: string[] | string;
  verbose?: boolean;
}

/**
 * Starts the long-running gateway that wires agent processing to configured channels.
 */
export async function runGateway(options: GatewayArgs): Promise<void> {
  const channelList = normalizeChannels(options.channels);
  const config = await loadConfig(options.config);
  if (options.verbose) {
    config.channels = config.channels ?? {};
    config.channels.cli = {
      ...(config.channels.cli ?? {}),
      verbose: true,
      enabled: config.channels.cli?.enabled !== false,
    };
  }
  const bus = new MessageBus();
  const agent = new TinybotAgent(bus, config);
  const channels = new ChannelManager(bus, config);

  await agent.start();
  await channels.start(channelList);

  if (channelList?.length) {
    consola.log(
      `tinybot gateway ready with channels: ${channelList.join(", ")} (Ctrl+C to stop)`,
    );
  } else {
    consola.log("tinybot gateway ready (Ctrl+C to stop)");
  }

  await waitForShutdown();

  await channels.stop();
  agent.stop();
}

/**
 * Normalizes channel input values into a deduplicated list-ready array.
 */
function normalizeChannels(value?: string[] | string): string[] | undefined {
  if (!value) return undefined;

  const splitParts = (input: string): string[] =>
    input
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);

  if (Array.isArray(value)) {
    const normalized = value
      .flatMap((part) => splitParts(part));
    return normalized.length ? [...new Set(normalized)] : undefined;
  }

  const normalized = splitParts(value);
  return normalized.length ? [...new Set(normalized)] : undefined;
}

/**
 * Resolves when the current process receives a shutdown signal.
 */
function waitForShutdown(): Promise<void> {
  if (typeof process === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

if (import.meta.main) {
  await runGateway({});
}
