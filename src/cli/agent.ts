import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { OutboundMessage } from "../core/bus.ts";
import { stdin as input, stdout as output } from "node:process";
import { clearLine, cursorTo } from "node:readline";
import readline from "node:readline/promises";
import { consola } from "consola";
import { attachCliChannel } from "../channels/cli.ts";
import { loadConfig } from "../config/loader.ts";
import { TinybotAgent } from "../core/agent.ts";
import { MessageBus } from "../core/bus.ts";

interface AgentCliArgs {
  config?: string;
  message?: string;
  session: string;
  interactive: boolean;
  verbose: boolean;
}

const ONE_SHOT_WAIT_TIMEOUT_MS = 60_000;
const INTERACTIVE_PROMPT = "> ";

interface InteractivePromptState {
  active: boolean;
}

/**
 * Runs the agent in one-shot mode or interactive CLI mode.
 */
export async function runAgent(options: AgentCliArgs): Promise<void> {
  const target = resolveSessionTarget(options.session);
  const config = await loadConfig(options.config);
  const bus = new MessageBus();

  const verbose = options.verbose || config.channels?.cli?.verbose;
  let rl: ReadlineInterface | undefined;
  const promptState: InteractivePromptState = { active: false };

  if (options.interactive) {
    rl = readline.createInterface({ input, output, terminal: true });
    attachCliChannel(bus, {
      verbose,
      writeLine: createInteractiveWriteLine(rl, promptState),
    });
  } else {
    attachCliChannel(bus, { verbose });
  }

  const agent = new TinybotAgent(bus, config);

  await agent.start();
  try {
    if (options.interactive) {
      consola.log("tinybot interactive mode. Type /exit to quit.\n");
      await runInteractiveSession(agent, target, rl!, promptState);
      return;
    }

    if (options.message) {
      consola.log(`Queued message: ${options.message}`);
      try {
        await waitForResponse(
          agent,
          target,
          options.message,
          ONE_SHOT_WAIT_TIMEOUT_MS,
        );
      } catch {
        consola.warn(
          `No response received within ${ONE_SHOT_WAIT_TIMEOUT_MS}ms, stopping agent.`,
        );
      }
      return;
    }

    consola.log('tinybot agent ready. Use --message "..." or --interactive.');
  } finally {
    agent.stop();
  }
}

export interface SessionTarget {
  channel: string;
  chatId: string;
}

/**
 * Starts a readline loop that sends each user message to the agent until exit.
 */
async function runInteractiveSession(
  agent: TinybotAgent,
  target: SessionTarget,
  rl: ReadlineInterface,
  promptState: InteractivePromptState,
): Promise<void> {
  const cleanup = () => {
    rl.close();
  };

  rl.on("SIGINT", () => {
    cleanup();
  });

  try {
    while (true) {
      promptState.active = true;
      const line = await rl.question(INTERACTIVE_PROMPT);
      promptState.active = false;
      const value = line.trim();
      if (!value) continue;
      if (value === "/exit" || value === "/quit") {
        break;
      }

      try {
        await waitForResponse(agent, target, value);
      } catch (error) {
        consola.warn(`Failed to get response: ${(error as Error).message}`);
      }
    }
  } finally {
    cleanup();
  }
}

function createInteractiveWriteLine(
  rl: ReadlineInterface,
  promptState: InteractivePromptState,
): (line: string) => void {
  return (line: string) => {
    if (!promptState.active) {
      output.write(`${line}\n`);
      return;
    }

    const currentInput = rl.line ?? "";
    const currentCursor = Math.max(
      0,
      Math.min(rl.cursor ?? currentInput.length, currentInput.length),
    );
    clearLine(output, 0);
    cursorTo(output, 0);
    output.write(`${line}\n`);
    output.write(`${INTERACTIVE_PROMPT}${currentInput}`);
    cursorTo(output, INTERACTIVE_PROMPT.length + currentCursor);
  };
}

/**
 * Waits for a reply on the target session and optionally enqueues a new message.
 */
export async function waitForResponse(
  agent: TinybotAgent,
  target: SessionTarget,
  message: string,
  timeoutMs = 60_000,
  enqueueMessage = true,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const bus = agent.bus;
    let settled = false;

    let timeout: ReturnType<typeof setTimeout>;
    let handler: (msg: OutboundMessage) => Promise<void>;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bus.unsubscribeOutbound(target.channel, handler);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    handler = async (msg: OutboundMessage) => {
      if (msg.chatId === target.chatId && msg.kind !== "delta") {
        finish();
      }
    };

    timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for response after ${timeoutMs}ms`));
    }, timeoutMs);

    bus.subscribeOutbound(target.channel, handler);

    if (enqueueMessage) {
      agent.enqueueMessage(message, target).catch((error) => {
        finish(error as Error);
      });
    }
  });
}

/**
 * Parses a session identifier into channel and chat target fields.
 */
export function resolveSessionTarget(sessionId: string): SessionTarget {
  if (!sessionId.includes(":")) {
    return { channel: "cli", chatId: sessionId || "default" };
  }
  const [channel, chatId] = sessionId.split(":", 2);
  return {
    channel: channel || "cli",
    chatId: chatId || "default",
  };
}
