import type {
  ExecOptions,
  TinybotChannelsConfig,
  TinybotConfig,
  TinybotCronConfig,
  TinybotHeartbeatConfig,
  TinybotProviderConfig,
  TinybotToolsConfig,
} from "./types.ts";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { consola } from "consola";
import { defaultConfig } from "./default.ts";

/**
 * Deep-merges user configuration values over defaults for nested config sections.
 */
function mergeConfig(
  base: TinybotConfig,
  override: Partial<TinybotConfig>,
): TinybotConfig {
  return {
    ...base,
    ...override,
    exec: {
      ...base.exec,
      ...override.exec,
    } satisfies ExecOptions,
    channels: {
      ...base.channels,
      ...override.channels,
    } satisfies TinybotChannelsConfig,
    tools: {
      ...base.tools,
      ...override.tools,
      web: {
        ...base.tools?.web,
        ...override.tools?.web,
      },
    } satisfies TinybotToolsConfig,
    cron: {
      ...base.cron,
      ...override.cron,
    } satisfies TinybotCronConfig,
    heartbeat: {
      ...base.heartbeat,
      ...override.heartbeat,
    } satisfies TinybotHeartbeatConfig,
    provider: {
      ...base.provider,
      ...override.provider,
    } satisfies TinybotProviderConfig,
  };
}

/**
 * Loads configuration from file and environment variables with safe fallbacks.
 */
export async function loadConfig(
  configPath = "tinybot.config.json",
): Promise<TinybotConfig> {
  let config = defaultConfig;
  try {
    const data = await readFile(configPath, "utf8");
    const parsed = JSON.parse(data);
    config = mergeConfig(defaultConfig, parsed as Partial<TinybotConfig>);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFoundError" || error.name === "ENOENT")
    ) {
      consola.warn(
        `tinybot config not found at ${configPath}, using defaults.`,
      );
    } else {
      consola.warn(`Failed to load config: ${(error as Error).message}`);
    }
  }

  // Override with environment variables
  const envOverrides: Partial<TinybotConfig> = {
    ...(process.env.TINYBOT_WORKSPACE && {
      workspace: process.env.TINYBOT_WORKSPACE,
    }),
    ...(process.env.TINYBOT_MODEL && { model: process.env.TINYBOT_MODEL }),
    ...(process.env.OPENAI_API_BASE && {
      apiBase: process.env.OPENAI_API_BASE,
    }),
    ...(process.env.OPENAI_API_KEY && { apiKey: process.env.OPENAI_API_KEY }),
  };
  if (process.env.TINYBOT_MAX_TOOL_ITERATIONS) {
    const parsed = Number.parseInt(process.env.TINYBOT_MAX_TOOL_ITERATIONS, 10);
    if (!Number.isNaN(parsed)) envOverrides.maxToolIterations = parsed;
  }

  const providerEnv: Partial<TinybotProviderConfig> = {
    ...(process.env.TINYBOT_PROVIDER_TYPE && {
      type: process.env.TINYBOT_PROVIDER_TYPE as TinybotProviderConfig["type"],
    }),
    ...(process.env.TINYBOT_PROVIDER_MODEL && {
      model: process.env.TINYBOT_PROVIDER_MODEL,
    }),
    ...(process.env.TINYBOT_PROVIDER_API_BASE && {
      apiBase: process.env.TINYBOT_PROVIDER_API_BASE,
    }),
    ...(process.env.TINYBOT_PROVIDER_API_KEY && {
      apiKey: process.env.TINYBOT_PROVIDER_API_KEY,
    }),
    ...(process.env.TINYBOT_PROVIDER_TARGET && {
      targetProvider: process.env.TINYBOT_PROVIDER_TARGET,
    }),
    ...(process.env.OPENAI_API_BASE && {
      apiBase: process.env.OPENAI_API_BASE,
    }),
    ...(process.env.OPENAI_API_KEY && { apiKey: process.env.OPENAI_API_KEY }),
  };
  if (Object.keys(providerEnv).length) {
    envOverrides.provider = {
      ...(envOverrides.provider ?? {}),
      ...providerEnv,
    };
  }

  return mergeConfig(config, envOverrides);
}
