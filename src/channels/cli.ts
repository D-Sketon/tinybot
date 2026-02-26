import type { MessageBus, OutboundMessage } from "../core/bus.ts";
import { consola } from "consola";

export interface CliChannelOptions {
  verbose?: boolean;
  writeLine?: (line: string) => void;
}

function colorCyan(value: string): string {
  return `\u001B[36m${value}\u001B[0m`;
}

/**
 * Attaches a stdout-based outbound listener for CLI channel messages.
 */
export function attachCliChannel(
  bus: MessageBus,
  options: CliChannelOptions = {},
): void {
  const prefix = options.verbose ? "tinybot(cli,verbose)" : "tinybot";
  bus.subscribeOutbound("cli", async (message: OutboundMessage) => {
    if (options.verbose) {
      const header = colorCyan(`${prefix} [${message.chatId}] ->`);
      const payload = colorCyan(JSON.stringify(message, null, 2));
      if (options.writeLine) {
        options.writeLine(header);
        options.writeLine(payload);
      } else {
        consola.log(header, payload);
      }
      return;
    }
    const line = colorCyan(`${prefix} [${message.chatId}]: ${message.content}`);
    if (options.writeLine) {
      options.writeLine(line);
      return;
    }
    consola.log(line);
  });
}
