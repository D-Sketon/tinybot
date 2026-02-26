import { cac } from "cac";
import { runAgent } from "./agent.ts";
import { runGateway } from "./gateway.ts";
import { runInit } from "./init.ts";
import { runStatusCommand } from "./status.ts";

const cli = cac("tinybot");

cli
  .command("agent", "Run the agent loop once or interactively")
  .option("-m, --message <msg>", "Message to send")
  .option("-s, --session <id>", "Session ID", { default: "cli:default" })
  .option("-c, --config <path>", "Config path")
  .option("-i, --interactive", "Interactive mode")
  .option("-v, --verbose", "Verbose output")
  .action(runAgent);

cli
  .command("gateway", "Run the long-lived agent + channel gateway")
  .option("-c, --config <path>", "Config path")
  .option("--channels <list>", "Comma-separated list of channels to start")
  .option("-v, --verbose", "Verbose output")
  .action(runGateway);

cli
  .command("init", "Initialize config and workspace")
  .option("-c, --config <path>", "Config path", {
    default: "tinybot.config.json",
  })
  .option("-w, --workspace <path>", "Workspace path", {
    default: "./workspace",
  })
  .option("--force", "Overwrite existing files")
  .action(runInit);

cli
  .command("status", "Show config and workspace status")
  .option("-c, --config <path>", "Config path")
  .option("--json", "Output status as JSON")
  .action(runStatusCommand);

cli.help();

if (import.meta.main) {
  runTinybotCli();
}

export async function runTinybotCli(args?: string[]): Promise<void> {
  cli.parse(args);
}
