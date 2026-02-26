import type { TinybotConfig } from "./types";

export const defaultConfig: TinybotConfig = {
  workspace: "./workspace",
  maxToolIterations: 6,
  provider: {
    type: "mock",
    model: "gpt-4o-mini",
    apiBase: "https://api.openai.com/v1",
  },
  exec: {
    timeout: 5000,
    restrictToWorkspace: true,
  },
  channels: {
    cli: { enabled: true, verbose: false },
    webhook: {
      enabled: false,
      port: 18790,
      host: "0.0.0.0",
      waitTimeoutMs: 15000,
      healthUrl: "http://127.0.0.1:18790/health",
    },
  },
  tools: {
    web: { maxResults: 5 },
  },
  cron: {
    enabled: false,
  },
  heartbeat: {
    enabled: false,
    intervalSeconds: 30 * 60,
  },
};
