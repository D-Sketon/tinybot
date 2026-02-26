export interface ExecOptions {
  timeout?: number;
  restrictToWorkspace?: boolean;
  deny?: string[];
  allow?: string[];
}

export interface CliChannelConfig {
  enabled?: boolean;
  verbose?: boolean;
}

export interface WebhookChannelConfig {
  enabled?: boolean;
  secret?: string;
  port?: number;
  host?: string;
  waitTimeoutMs?: number;
  healthUrl?: string;
}

export interface TinybotChannelsConfig {
  cli?: CliChannelConfig;
  webhook?: WebhookChannelConfig;
}

export interface TinybotToolsConfig {
  web?: {
    maxResults?: number;
  };
}

export interface TinybotCronConfig {
  enabled?: boolean;
  storePath?: string;
}

export interface TinybotHeartbeatConfig {
  enabled?: boolean;
  intervalSeconds?: number;
}

export type ProviderKind = "mock" | "openai" | "litellm";

export interface TinybotProviderConfig {
  type?: ProviderKind;
  apiKey?: string;
  apiBase?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  targetProvider?: string;
}

export type TinybotProvidersConfig = Record<string, TinybotProviderConfig>;

export interface TinybotConfig {
  workspace?: string;
  maxToolIterations?: number;
  exec?: ExecOptions;
  channels?: TinybotChannelsConfig;
  tools?: TinybotToolsConfig;
  cron?: TinybotCronConfig;
  heartbeat?: TinybotHeartbeatConfig;
  provider?: TinybotProviderConfig;
  providers?: TinybotProvidersConfig;
}
