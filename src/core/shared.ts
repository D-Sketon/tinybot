import type { ExecOptions } from "node:child_process";
import type { AgentMessage } from "./context";
import type { AssistantResponse, Provider } from "./provider";
import type { BaseTool } from "./tools/base";
import { ExecTool } from "./tools/exec";
import {
  EditFileTool,
  ListDirTool,
  ReadFileTool,
  WriteFileTool,
} from "./tools/fs";
import { ToolRegistry } from "./tools/registry";
import { WebFetchTool, WebSearchTool } from "./tools/web";

interface LoopOptions {
  maxIterations?: number;
  messages: AgentMessage[];
  provider: Provider;
  tools: ToolRegistry;
  sessionMessages?: AgentMessage[];
  onStreamDelta?: (delta: string) => void | Promise<void>;
}

/**
 * Runs the agent turn loop until completion, tool exhaustion, or iteration limit.
 */
export async function loop({
  maxIterations = 10,
  messages,
  provider,
  tools,
  sessionMessages = [],
  onStreamDelta,
}: LoopOptions) {
  let finalContent: string | null = null;
  let status: "ok" | "error" = "ok";
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let response: AssistantResponse;
    try {
      if (provider.generateStream && onStreamDelta) {
        response = await provider.generateStream(
          messages,
          tools.getDefinitions(),
          onStreamDelta,
        );
      } else {
        response = await provider.generate(messages, tools.getDefinitions());
      }
    } catch (error) {
      finalContent = `Provider error: ${(error as Error).message}`;
      status = "error";
      break;
    }

    if (response.toolCalls && response.toolCalls.length) {
      // Add assistant message with tool calls
      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      };
      messages.push(assistantMessage);
      sessionMessages.push(assistantMessage);

      // Execute tools
      for (const toolCall of response.toolCalls) {
        let result: string;
        try {
          result = await tools.execute(toolCall.name, toolCall.arguments);
        } catch (error: any) {
          status = "error";
          result = `Tool ${toolCall.name} failed: ${error?.message ?? "unknown error"}`;
        }
        const toolMessage: AgentMessage = {
          role: "tool",
          content: result,
          toolCallId: toolCall.id,
          name: toolCall.name,
        };
        messages.push(toolMessage);
        sessionMessages.push(toolMessage);
      }
    } else {
      finalContent =
        response.content ??
        "Task completed but no final response was produced.";
      sessionMessages.push({
        role: "assistant",
        content: finalContent,
      });
      break;
    }
  }

  if (finalContent === null) {
    finalContent = "Max iterations reached without a final response.";
    sessionMessages.push({
      role: "assistant",
      content: finalContent,
    });
  }
  return {
    content: finalContent,
    status,
  };
}

interface WorkspaceToolOptions {
  workspace: string;
  execOptions: ExecOptions;
  webOptions?: {
    maxResults?: number;
  };
  extras?: BaseTool[];
  registry?: ToolRegistry;
}

/**
 * Registers standard workspace tools and optional extras into a tool registry.
 */
export function buildWorkspaceTools({
  workspace,
  execOptions,
  webOptions,
  extras = [],
  registry,
}: WorkspaceToolOptions): ToolRegistry {
  const tools = registry ?? new ToolRegistry();

  tools.register(new ReadFileTool(workspace));
  tools.register(new WriteFileTool(workspace));
  tools.register(new ListDirTool(workspace));
  tools.register(new EditFileTool(workspace));
  tools.register(new ExecTool(workspace, execOptions));
  tools.register(new WebFetchTool());
  tools.register(
    new WebSearchTool({
      maxResults: webOptions?.maxResults,
    }),
  );

  for (const tool of extras) {
    tools.register(tool);
  }

  return tools;
}
