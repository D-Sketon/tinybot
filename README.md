# tinybot

A lightweight agent framework built with Bun and TypeScript for learning and prototyping — not production-ready. Inspired by OpenClaw and nanobot.

## Features

- Supports three providers: `mock`, `openai`, and `litellm`
- Supports `cli` and `webhook` channels
- Built-in tools: file read/write, directory listing, command execution, web fetch, and web search
- Session persistence, memory injection, and skills summary
- System-triggered messages via `cron` and `heartbeat`
- Parallel sub-tasks via `subagent`

## Quick Start

```bash
bun install
bun run tinybot init
bun run tinybot agent --message "hello"
```

Interactive mode:

```bash
bun run tinybot agent --interactive
```

Gateway mode (long-running):

```bash
bun run tinybot gateway
```

## CLI Commands

```bash
bun run tinybot <command>
```

- `agent`
  - `--message <msg>` send a one-shot message
  - `--session <id>` session ID (default: `cli:default`)
  - `--interactive` interactive mode
  - `--config <path>` config path
  - `--verbose` verbose CLI output
- `gateway`
  - start Agent + ChannelManager
  - `--channels <list>` start only selected channels (comma/space separated)
- `init`
  - initialize config and `workspace/`
  - `--force` overwrite existing files
- `status`
  - show config, workspace, provider, and channel health
  - `--json` output JSON

## Configuration (`tinybot.config.json`)

Key fields:

- `workspace`
- `maxToolIterations`
- `provider`: `type`/`model`/`apiBase`/`apiKey`/`temperature`/`maxTokens`
- `exec`: `timeout`/`restrictToWorkspace`/`allow`/`deny`
- `channels.cli` / `channels.webhook`
- `tools.web.maxResults`
- `cron.enabled` / `cron.storePath`
- `heartbeat.enabled` / `heartbeat.intervalSeconds`

Environment variable overrides (implemented):

- `TINYBOT_WORKSPACE`
- `TINYBOT_MAX_TOOL_ITERATIONS`
- `OPENAI_API_BASE` / `OPENAI_API_KEY`
- `TINYBOT_PROVIDER_TYPE`
- `TINYBOT_PROVIDER_MODEL`
- `TINYBOT_PROVIDER_API_BASE`
- `TINYBOT_PROVIDER_API_KEY`
- `TINYBOT_PROVIDER_TARGET`

## Webhook

- `GET /health`
- `POST /inbound`
- optional `x-tinybot-secret` validation
- waits for reply by default; use `?wait=false` for enqueue-only

Example:

```json
{
  "channel": "webhook",
  "chatId": "demo-chat",
  "senderId": "user-1",
  "content": "Please summarize today's TODO",
  "media": [],
  "metadata": {}
}
```

## Development

```bash
bun run lint
bun run build
bun run test
bun run test:cov
```

## Project Structure

- `src/core`: agent, provider, bus, session, memory, skills, cron, heartbeat
- `src/core/tools`: built-in tools
- `src/channels`: cli/webhook and channel manager
- `src/cli`: CLI entry commands
- `src/config`: defaults, types, and loader
- `workspace`: runtime data (memory / sessions / skills)

