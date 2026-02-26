import process from "node:process";
import { runTinybotCli } from "./cli/main.ts";
export { runAgent } from "./cli/agent.ts";
export { runGateway } from "./cli/gateway.ts";
export { runInit } from "./cli/init.ts";
export { runStatusCommand } from "./cli/status.ts";

if (import.meta.main) {
  runTinybotCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { runTinybotCli };
