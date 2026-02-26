import type { ChannelStatusRow } from "../channels/manager.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { consola } from "consola";
import { ChannelManager } from "../channels/manager.ts";
import { loadConfig } from "../config/loader.ts";

interface StatusArgs {
  config?: string;
  json?: boolean;
}

/**
 * Prints a summary of config, workspace, provider setup, and channel health.
 */
export async function runStatusCommand(options: StatusArgs): Promise<void> {
  const configPath = path.resolve(options.config ?? "tinybot.config.json");
  const config = await loadConfig(options.config);
  const workspace = path.resolve(config.workspace ?? "./workspace");
  const channelRows = await ChannelManager.inspectStatus(config);

  const providers = Object.entries(config.providers ?? {}).map(
    ([name, value]) => ({
      name,
      hasApiKey: Boolean(value?.apiKey),
      apiBase: value?.apiBase,
    }),
  );

  const summary = {
    configPath,
    workspace,
    configExists: existsSync(configPath),
    workspaceExists: existsSync(workspace),
    model: config.provider?.model,
    providerType: config.provider?.type,
    channels: {
      cli: config.channels?.cli?.enabled !== false,
      webhook: Boolean(config.channels?.webhook?.enabled),
    },
    providers,
    channelStatus: channelRows,
  };

  if (options.json) {
    consola.log(JSON.stringify(summary, null, 2));
    return;
  }

  consola.log(
    `Config: ${summary.configPath} ${summary.configExists ? "✓" : "✗"}`,
  );
  consola.log(
    `Workspace: ${summary.workspace} ${summary.workspaceExists ? "✓" : "✗"}`,
  );
  consola.log(`Model: ${summary.model ?? "(unset)"}`);
  consola.log(`Provider Type: ${summary.providerType ?? "(auto)"}`);
  consola.log(
    `Channels: ${
      Object.entries(summary.channels)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(", ") || "none"
    }`,
  );

  for (const provider of providers) {
    const status = provider.hasApiKey
      ? "apiKey set"
      : provider.apiBase
        ? `apiBase=${provider.apiBase}`
        : "not set";
    consola.log(`Provider/${provider.name}: ${status}`);
  }

  consola.log("Channel Health:");
  printStatusTable(channelRows);
}

/**
 * Renders channel status rows as a padded console table.
 */
function printStatusTable(rows: ChannelStatusRow[]): void {
  const headers = ["Channel", "Enabled", "Status", "Details"];
  const table = [
    headers,
    ...rows.map((row) => [
      row.name,
      row.enabled ? "yes" : "no",
      row.status,
      row.details,
    ]),
  ];
  const widths = headers.map((_, index) =>
    Math.max(...table.map((line) => (line[index] as string).length)),
  );
  const renderRow = (line: string[]) =>
    line.map((cell, idx) => (cell as string).padEnd(widths[idx]!)).join("  ");
  table.forEach((line, idx) => {
    consola.log(renderRow(line));
    if (idx === 0) {
      consola.log(widths.map((w) => "-".repeat(w)).join("  "));
    }
  });
}
