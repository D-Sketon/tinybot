import type { TinybotConfig, TinybotProviderConfig } from "../config/types.ts";
import type { AgentContent, AgentMessage } from "./context.ts";
import type { ToolSchema } from "./tools/base.ts";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AssistantResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export type StreamDeltaHandler = (delta: string) => void | Promise<void>;

export interface Provider {
  generate: (
    messages: AgentMessage[],
    tools?: ToolSchema[],
  ) => Promise<AssistantResponse>;
  generateStream?: (
    messages: AgentMessage[],
    tools: ToolSchema[] | undefined,
    onDelta?: StreamDeltaHandler,
  ) => Promise<AssistantResponse>;
}

export interface OpenAIProviderOptions {
  apiBase?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  targetProvider?: string;
}

interface ProviderEnvironmentHints {
  isOpenRouter: boolean;
  isAiHubMix: boolean;
  isVllm: boolean;
}

const KEYWORD_PREFIX_RULES: Array<{
  keywords: string[];
  prefix: string;
  skipPrefixes: string[];
}> = [
  {
    keywords: ["glm", "zhipu"],
    prefix: "zai",
    skipPrefixes: ["zhipu/", "zai/", "openrouter/", "hosted_vllm/"],
  },
  {
    keywords: ["qwen", "dashscope"],
    prefix: "dashscope",
    skipPrefixes: ["dashscope/", "openrouter/"],
  },
  {
    keywords: ["moonshot", "kimi"],
    prefix: "moonshot",
    skipPrefixes: ["moonshot/", "openrouter/"],
  },
  {
    keywords: ["gemini"],
    prefix: "gemini",
    skipPrefixes: ["gemini/"],
  },
];

/**
 * Infers provider environment hints from API endpoint and key patterns.
 */
function detectProviderEnvironment(
  options: OpenAIProviderOptions = {},
): ProviderEnvironmentHints {
  const apiKey = options.apiKey ?? "";
  const apiBase = options.apiBase?.toLowerCase() ?? "";
  const isOpenRouter =
    apiKey.startsWith("sk-or-") || apiBase.includes("openrouter");
  const isAiHubMix = apiBase.includes("aihubmix");
  const isVllm = Boolean(options.apiBase) && !isOpenRouter && !isAiHubMix;
  return {
    isOpenRouter,
    isAiHubMix,
    isVllm,
  };
}

/**
 * Applies provider-specific model prefixes based on model keywords.
 */
function applyKeywordPrefixes(model: string): string {
  const lower = model.toLowerCase();
  for (const rule of KEYWORD_PREFIX_RULES) {
    if (!rule.keywords.some((keyword) => lower.includes(keyword))) {
      continue;
    }
    if (rule.skipPrefixes.some((prefix) => model.startsWith(prefix))) {
      continue;
    }
    return `${rule.prefix}/${model}`;
  }
  return model;
}

function mapMessages(messages: AgentMessage[]): unknown[] {
  return messages.map((m) => {
    const payload: Record<string, unknown> = {
      role: m.role,
      content: m.content,
    };
    if (m.toolCallId) payload.tool_call_id = m.toolCallId;
    if (m.name) payload.name = m.name;
    if (m.toolCalls) {
      payload.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }
    return payload;
  });
}

function mapTools(tools?: ToolSchema[]): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(raw: any[] | undefined): ToolCall[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map((tc) => ({
    id: tc.id,
    name: tc.function?.name ?? tc.name,
    arguments: safeParseArguments(
      tc.function?.arguments ?? tc.arguments ?? "{}",
    ),
  }));
}

function safeParseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return (value as Record<string, unknown>) ?? {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value } as Record<string, unknown>;
  }
}

export class MockProvider implements Provider {
  /**
   * Returns a deterministic echo response for testing and fallback scenarios.
   */
  async generate(messages: AgentMessage[]): Promise<AssistantResponse> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const normalized = normalizeContent(lastUser?.content);
    const preview =
      normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized;
    return {
      content: `Echo (mock): ${preview}`,
    };
  }

  /**
   * Emits a deterministic stream of content chunks for testing.
   */
  async generateStream(
    messages: AgentMessage[],
    _tools?: ToolSchema[],
    onDelta?: StreamDeltaHandler,
  ): Promise<AssistantResponse> {
    const response = await this.generate(messages);
    const content = response.content ?? "";
    if (onDelta) {
      const chunkSize = Math.max(1, Math.ceil(content.length / 3));
      for (let i = 0; i < content.length; i += chunkSize) {
        await onDelta(content.slice(i, i + chunkSize));
      }
    }
    return response;
  }
}

/**
 * Sends chat completions requests to OpenAI-compatible APIs.
 */
export class OpenAIProvider implements Provider {
  constructor(protected readonly options: OpenAIProviderOptions = {}) {}

  protected get apiBase(): string {
    return this.options.apiBase ?? "https://api.openai.com/v1";
  }

  protected get model(): string {
    return this.options.model ?? "gpt-4o-mini";
  }

  /**
   * Generates an assistant response with optional tool call output.
   */
  async generate(
    messages: AgentMessage[],
    tools?: ToolSchema[],
  ): Promise<AssistantResponse> {
    const body = this.buildRequestBody(messages, tools);
    const response = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message ?? {};

    return {
      content: message.content ?? "",
      toolCalls: parseToolCalls(message.tool_calls),
    };
  }

  /**
   * Streams assistant deltas and returns the final response payload.
   */
  async generateStream(
    messages: AgentMessage[],
    tools?: ToolSchema[],
    onDelta?: StreamDeltaHandler,
  ): Promise<AssistantResponse> {
    const body = this.buildRequestBody(messages, tools);
    body.stream = true;
    const response = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      return this.generate(messages, tools);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const chunks: string[] = [];
    const toolCalls = new Map<number, {
      id?: string;
      name?: string;
      arguments?: string;
    }>();

    const applyToolCallDelta = (deltaCalls: any[]) => {
      for (const call of deltaCalls) {
        const index = typeof call.index === "number" ? call.index : 0;
        const current = toolCalls.get(index) ?? { arguments: "" };
        if (typeof call.id === "string") {
          current.id = call.id;
        }
        const fn = call.function;
        if (fn?.name) {
          current.name = fn.name;
        }
        if (fn?.arguments) {
          current.arguments = `${current.arguments ?? ""}${fn.arguments}`;
        }
        toolCalls.set(index, current);
      }
    };

    const flushLine = async (line: string): Promise<boolean> => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      const data = trimmed.slice(5).trim();
      if (!data) return false;
      if (data === "[DONE]") return true;
      let payload: any;
      try {
        payload = JSON.parse(data);
      } catch {
        return false;
      }
      const delta = payload?.choices?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content.length) {
        chunks.push(delta.content);
        if (onDelta) {
          await onDelta(delta.content);
        }
      }
      if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length) {
        applyToolCallDelta(delta.tool_calls);
      }
      return false;
    };

    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let lineBreak = buffer.indexOf("\n");
      while (lineBreak !== -1) {
        const line = buffer.slice(0, lineBreak);
        buffer = buffer.slice(lineBreak + 1);
        if (await flushLine(line)) {
          done = true;
          break;
        }
        lineBreak = buffer.indexOf("\n");
      }
    }

    const content = chunks.join("");
    const toolCallsList = toolCalls.size
      ? [...toolCalls.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, call]) => ({
            id: call.id ?? `call-${index}`,
            name: call.name ?? "unknown",
            arguments: safeParseArguments(call.arguments ?? "{}"),
          }))
      : undefined;

    return {
      content,
      toolCalls: toolCallsList,
    };
  }

  protected buildRequestBody(
    messages: AgentMessage[],
    tools?: ToolSchema[],
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: mapMessages(messages),
      temperature: this.options.temperature ?? 0.7,
    };
    if (this.options.maxTokens !== undefined) {
      body.max_tokens = this.options.maxTokens;
    }
    const mappedTools = mapTools(tools);
    if (mappedTools) {
      body.tools = mappedTools;
      body.tool_choice = "auto";
    }
    return body;
  }

  protected buildHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.options.apiKey) {
      headers.Authorization = `Bearer ${this.options.apiKey}`;
    }
    if (this.options.extraHeaders) {
      Object.assign(headers, this.options.extraHeaders);
    }
    return headers;
  }
}

function normalizeContent(content?: AgentContent): string {
  if (!content) {
    return "(no user content)";
  }
  if (typeof content !== "object") {
    return content;
  }
  const parts = content.map((part) => {
    if (part.type === "text") {
      return part.text;
    }
    return "[image]";
  });
  return parts.join("\n");
}

export class LiteLLMProvider extends OpenAIProvider {
  private readonly envHints: ProviderEnvironmentHints;

  constructor(options: OpenAIProviderOptions = {}) {
    super(options);
    this.envHints = detectProviderEnvironment(options);
  }

  protected override get apiBase(): string {
    if (this.options.apiBase) return this.options.apiBase;
    if (this.envHints.isOpenRouter) return "https://openrouter.ai/api/v1";
    if (this.envHints.isAiHubMix) return "https://api.aihubmix.com/v1";
    return "http://localhost:4000";
  }

  protected override buildRequestBody(
    messages: AgentMessage[],
    tools?: ToolSchema[],
  ): Record<string, unknown> {
    const body = super.buildRequestBody(messages, tools);
    const originalModel =
      typeof body.model === "string" ? body.model : this.model;
    body.model = this.normalizeModelName(originalModel);
    if (this.options.targetProvider) {
      body.provider = this.options.targetProvider;
    } else if (this.envHints.isAiHubMix) {
      body.provider = "openai";
    }
    return body;
  }

  protected override buildHeaders(): HeadersInit {
    const headers = super.buildHeaders() as Record<string, string>;
    if (this.envHints.isOpenRouter) {
      headers["HTTP-Referer"] ??= "https://github.com/hkuds/tinybot";
      headers["X-Title"] ??= "tinybot";
    }
    return headers;
  }

  private normalizeModelName(modelInput: string): string {
    let model = modelInput;

    // Normalize keyword-specific providers
    model = applyKeywordPrefixes(model);

    if (this.envHints.isOpenRouter && !model.startsWith("openrouter/")) {
      return `openrouter/${model}`;
    }
    if (this.envHints.isAiHubMix) {
      const leaf = model.split("/").pop() ?? model;
      return `openai/${leaf}`;
    }
    if (this.envHints.isVllm && !model.startsWith("hosted_vllm/")) {
      return `hosted_vllm/${model}`;
    }
    return model;
  }
}

function resolveProviderSettings(config: TinybotConfig): TinybotProviderConfig {
  const provider = config.provider ?? {};
  return {
    type: provider.type ?? (provider.apiKey ? "openai" : "mock"),
    apiKey: provider.apiKey,
    apiBase: provider.apiBase,
    model: provider.model,
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
    extraHeaders: provider.extraHeaders,
    targetProvider: provider.targetProvider,
  };
}

/**
 * Creates the runtime provider implementation from resolved configuration.
 */
export function createProvider(config: TinybotConfig): Provider {
  const provider = resolveProviderSettings(config);
  switch (provider.type) {
    case "openai":
      return new OpenAIProvider(provider);
    case "litellm":
      return new LiteLLMProvider(provider);
    default:
      return new MockProvider();
  }
}
