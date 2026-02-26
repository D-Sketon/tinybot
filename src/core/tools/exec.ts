import type { ExecOptions } from "../../config/types.ts";
import type { ToolSchema } from "./base.ts";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { BaseTool } from "./base.ts";

const DEFAULT_DENY_LIST = [
  "\\bdd\\s+if=",
  ">\\s*/dev/sd",
  "\\bmkfs(\\.[a-z0-9]+)?\\b",
  "\\b(format(\\.com|\\.exe)?|diskpart(\\.exe)?)\\b",
  "\\b(clear-disk|format-volume|initialize-disk|new-partition|remove-partition|resize-partition|set-disk)\\b",
  "\\b(bcdedit|bootrec|bootsect|mountvol|fsutil)\\b",
  "\\b(chkdsk)\\b\\s+/f\\b",
  "\\b(stop-computer|restart-computer)\\b",
  "\\b(shutdown|reboot|poweroff)\\b",
  "\\bvssadmin\\b\\s+delete\\s+shadows\\b",
  "\\bwmic\\b\\s+shadowcopy\\b\\s+delete\\b",
  ":\\(\\)\\s*\\{.*\\};\\s*:",
];

/**
 * Enforces allow/deny execution policies before running shell commands.
 */
function validateAgainstLists(command: string, execOpts: ExecOptions): void {
  if (execOpts.allow?.length) {
    const allowed = execOpts.allow.some((pattern) =>
      new RegExp(pattern).test(command),
    );
    if (!allowed) {
      throw new Error("Command not allowed by allow-list");
    }
  }
  const denyList =
    execOpts.deny === undefined ? DEFAULT_DENY_LIST : execOpts.deny;
  if (denyList.length) {
    const denied = denyList.some((pattern) =>
      new RegExp(pattern, "i").test(command),
    );
    if (denied) {
      throw new Error("Command denied by deny-list");
    }
  }
}

function decodeIfEncoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Best-effort guard for workspace-restricted shell usage.
 *
 * Because commands are executed through a shell string, we cannot fully parse every
 * shell grammar variant safely. This heuristic blocks common breakout patterns:
 * - parent directory traversal segments (../ or ..\\)
 * - absolute paths (Unix /x, Windows C:\\x, UNC \\server\\share)
 * - URL-encoded traversal/absolute-path payloads
 */
function violatesWorkspaceRestriction(command: string): boolean {
  const candidates = [command, decodeIfEncoded(command)];

  const parentTraversal = /(?:^|[\s'"`;(])\.\.(?:[\\/]|$)/;
  const windowsDriveAbsolute = /(?:^|[\s'"`;(])[a-z]:[\\/]/i;
  const uncAbsolute = /(?:^|[\s'"`;(])\\\\[^\\\s]+\\[^\\\s]+/;
  const unixAbsolute = /(?:^|[\s'"`;(])\/(?!\s)/;

  return candidates.some(
    (value) =>
      parentTraversal.test(value) ||
      windowsDriveAbsolute.test(value) ||
      uncAbsolute.test(value) ||
      unixAbsolute.test(value),
  );
}

/**
 * Executes shell commands inside the workspace with timeout and safety controls.
 */
export class ExecTool extends BaseTool {
  override readonly name = "exec";
  override readonly description =
    "Execute a shell command with timeout and optional workspace restriction.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        timeout: {
          type: "number",
          description:
            "Optional timeout in milliseconds; defaults to config value.",
        },
      },
      required: ["command"],
    },
  };

  constructor(
    private workspace: string,
    private execOptions: ExecOptions,
  ) {
    super();
  }

  /**
   * Runs a validated command and returns combined execution output.
   */
  async execute(args: Record<string, unknown>): Promise<string> {
    const command = args.command as string;
    const timeoutMs =
      typeof args.timeout === "number"
        ? args.timeout
        : (this.execOptions.timeout ?? 5000);

    validateAgainstLists(command, this.execOptions);

    if (
      this.execOptions.restrictToWorkspace &&
      violatesWorkspaceRestriction(command)
    ) {
      throw new Error("Command rejected: outside-workspace path detected");
    }

    const shell =
      process.platform === "win32"
        ? ["cmd", "/C", command]
        : ["/bin/sh", "-c", command];
    const proc = Bun.spawn(shell, {
      cwd: this.workspace,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();

    const timedOut = sleep(timeoutMs, "timeout");

    const result = await Promise.race([
      Promise.all([proc.exited, stdoutPromise, stderrPromise]),
      timedOut,
    ]);

    if (result === "timeout") {
      proc.kill();
      throw new Error(`Command timed out after ${timeoutMs}ms`);
    }

    const [exitCode, stdout, stderr] = result as [number, string, string];

    if (exitCode !== 0) {
      return `exit ${exitCode}\nstderr:\n${stderr}\nstdout:\n${stdout}`.trim();
    }

    return stdout.trim();
  }
}
