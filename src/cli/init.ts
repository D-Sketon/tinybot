import type { TinybotConfig } from "../config/types.ts";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { consola } from "consola";
import { defaultConfig } from "../config/default.ts";

interface InitArgs {
  config?: string;
  workspace?: string;
  force?: boolean;
}

const WORKSPACE_FILES: Record<string, string> = {
  "AGENTS.md": `# Agent Contract

You are tinybot: a precise, safe, and execution-focused coding agent.

## Priority Order
1. Follow explicit user instructions.
2. Preserve safety and data integrity.
3. Complete the task end-to-end with verification.
4. Keep output concise and actionable.

## Hard Rules
- Explain intent before running tools or commands.
- Make minimal, targeted edits; avoid unrelated refactors.
- Ask before destructive or irreversible actions.
- Never fabricate results, paths, or command outputs.
- If uncertain, state assumptions explicitly.

## Execution Loop
1. Restate objective in one sentence.
2. Gather context from code/tests/docs.
3. Propose and apply smallest valid change.
4. Run focused validation, then broader checks if needed.
5. Report what changed, what was verified, and any risks.

## Response Quality
- Prefer bullets over long prose.
- Include file paths when describing changes.
- Separate facts from suggestions.
`,
  "SOUL.md": `# Soul

## Personality
- Calm under ambiguity.
- Pragmatic over perfectionism.
- Direct, friendly, and low-ego.

## Values
- Accuracy first, then speed.
- Transparency over confidence theater.
- Safety over convenience.

## Decision Style
- Choose the simplest solution that fully satisfies the request.
- Optimize for maintainability and debuggability.
`,
  "USER.md": `# User Profile

Capture stable collaboration preferences only.

## Write Here
- Preferred coding style and naming conventions
- Tolerance for risk (conservative vs fast iteration)
- Review habits (wants tests, wants diffs, etc.)

## Do Not Write Here
- Secrets, tokens, private credentials
- One-off transient details
`,
  "TOOLS.md": `# Tooling Policy

## General
- Use the least-powerful tool that can solve the task.
- Prefer deterministic operations over heuristic ones.
- Keep command output focused; avoid noisy logs.

## File Changes
- Read before edit when context is uncertain.
- Change only files relevant to the request.
- Preserve existing style and structure.

## Validation
- Start with tests closest to changed code.
- Escalate to broader test/build checks when appropriate.
- Report failures with probable cause and next step.
`,
  "IDENTITY.md": `# Identity

You operate inside tinybot (TypeScript / Bun) as a coding agent.

## Environment Boundaries
- Treat this repository as your workspace jail.
- Do not access paths outside the project unless explicitly requested.
- Assume local files may be proprietary; handle carefully.

## Mission
- Turn user intent into verified code changes with minimal friction.
`,
  "HEARTBEAT.md": `# Heartbeat Tasks

Keep short, actionable checkpoints that should be revisited automatically.

## Format
- [ ] Task
- [ ] Task

## Good Items
- Pending verification after major refactor
- Follow-up cleanup explicitly requested by user
`,
};

const MEMORY_FILES: Record<string, string> = {
  "memory/MEMORY.md": `# Long-term Memory

Record durable project decisions and constraints.

## Include
- Architecture decisions and rationale
- Non-obvious conventions that should persist
- Known limitations and accepted trade-offs

## Exclude
- Raw logs
- Temporary debugging notes
`,
  "memory/README.md": `Daily files (YYYY-MM-DD.md) store short-lived execution notes.

Promote only durable conclusions to MEMORY.md.
`,
};

const WORKSPACE_DIRS = ["memory", "sessions", "skills"];

const SKILLS_FILES: Record<string, string> = {
  "skills/README.md": `# Skills

Each skill lives in a subfolder with a SKILL.md.

## SKILL.md minimum
- YAML frontmatter: name, description
- Trigger guidance: when to use the skill
- Concrete workflows and examples

## Design Principles
- Keep core instructions concise.
- Move long references to separate files.
- Prefer executable scripts for repetitive deterministic tasks.
`,
};

/**
 * Initializes project configuration and scaffolds the default workspace layout.
 */
export async function runInit(options: InitArgs): Promise<void> {
  const config = options.config ?? "tinybot.config.json";
  const workspacePath = path.resolve(options.workspace ?? "./workspace");

  await writeConfig(config, options.force ?? false);
  await scaffoldWorkspace(workspacePath, options.force ?? false);

  consola.log(`\nTinybot is ready. Workspace: ${workspacePath}`);
}

/**
 * Writes the configuration file from template or defaults when needed.
 */
async function writeConfig(configPath: string, force: boolean): Promise<void> {
  if (existsSync(configPath) && !force) {
    consola.log(
      `Config already exists at ${configPath} (use --force to overwrite).`,
    );
    return;
  }

  const configDir = path.dirname(path.resolve(configPath));
  await mkdir(configDir, { recursive: true });

  const content = await readConfigTemplate();
  await writeFile(configPath, content, "utf8");
  consola.log(`Config written to ${configPath}`);
}

/**
 * Reads the example config file and falls back to default config JSON when unavailable.
 */
async function readConfigTemplate(): Promise<string> {
  const examplePath = path.resolve("tinybot.config.example.json");
  try {
    const text = await readFile(examplePath, "utf8");
    JSON.parse(text) as TinybotConfig;
    return text;
  } catch {
    return `${JSON.stringify(defaultConfig, null, 2)}\n`;
  }
}

/**
 * Creates required workspace directories and baseline documentation files.
 */
async function scaffoldWorkspace(
  workspacePath: string,
  force: boolean,
): Promise<void> {
  await mkdir(workspacePath, { recursive: true });
  for (const dir of WORKSPACE_DIRS) {
    await mkdir(path.join(workspacePath, dir), { recursive: true });
  }

  await Promise.all(
    Object.entries(WORKSPACE_FILES).map(([rel, content]) =>
      ensureFile(path.join(workspacePath, rel), content, force),
    ),
  );
  await Promise.all(
    Object.entries(MEMORY_FILES).map(([rel, content]) =>
      ensureFile(path.join(workspacePath, rel), content, force),
    ),
  );
  await Promise.all(
    Object.entries(SKILLS_FILES).map(([rel, content]) =>
      ensureFile(path.join(workspacePath, rel), content, force),
    ),
  );
}

/**
 * Ensures a file exists with expected content, optionally overwriting existing files.
 */
async function ensureFile(
  target: string,
  content: string,
  force: boolean,
): Promise<void> {
  if (existsSync(target) && !force) {
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  consola.log(`Created ${target}`);
}

if (import.meta.main) {
  runInit({}).catch((err) => {
    consola.error(err);

    process.exit(1);
  });
}
