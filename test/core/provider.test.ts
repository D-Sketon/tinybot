import type { AgentMessage } from "../../src/core/context.ts";

import type { ToolSchema } from "../../src/core/tools/base.ts";
import { describe, expect, it, vi } from "vitest";
import {
  createProvider,
  LiteLLMProvider,
  MockProvider,
  OpenAIProvider,
} from "../../src/core/provider.ts";

class TestOpenAIProvider extends OpenAIProvider {
  public exposeBuildRequestBody(
    messages: AgentMessage[],
    tools?: ToolSchema[],
  ) {
    return this.buildRequestBody(messages, tools);
  }
}

class TestLiteLLMProvider extends LiteLLMProvider {
  public exposeBuildRequestBody(
    messages: AgentMessage[],
    tools?: ToolSchema[],
  ) {
    return this.buildRequestBody(messages, tools);
  }
}

describe("providers", () => {
  it("mock provider echoes normalized user content with truncation", async () => {
    const provider = new MockProvider();
    const longText = "a".repeat(205);
    const messages: AgentMessage[] = [{ role: "user", content: longText }];

    const response = await provider.generate(messages);

    expect(response.content).toBe(`Echo (mock): ${longText.slice(0, 200)}...`);
  });

  it("openai provider builds tools payload", () => {
    const provider = new TestOpenAIProvider({
      model: "gpt-test",
      temperature: 0.2,
      maxTokens: 123,
    });
    const messages: AgentMessage[] = [{ role: "user", content: "hello" }];
    const tools: ToolSchema[] = [
      {
        name: "calc",
        description: "test tool",
        parameters: { type: "object", properties: { x: { type: "number" } } },
      },
    ];

    const body = provider.exposeBuildRequestBody(messages, tools);

    expect(body).toMatchObject({
      model: "gpt-test",
      temperature: 0.2,
      max_tokens: 123,
      tool_choice: "auto",
    });
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "calc",
          description: "test tool",
          parameters: { type: "object", properties: { x: { type: "number" } } },
        },
      },
    ]);
  });

  it("litellm provider normalizes model names per environment", () => {
    const openRouterProvider = new TestLiteLLMProvider({
      apiKey: "sk-or-test",
      model: "gpt-4o-mini",
    });
    const aihubProvider = new TestLiteLLMProvider({
      apiBase: "https://api.aihubmix.com/v1",
      model: "openai/gpt-4o-mini",
    });
    const vllmProvider = new TestLiteLLMProvider({
      apiBase: "http://localhost:8000",
      model: "qwen2.5",
    });
    const messages: AgentMessage[] = [{ role: "user", content: "ping" }];

    const openRouterBody = openRouterProvider.exposeBuildRequestBody(messages);
    const aihubBody = aihubProvider.exposeBuildRequestBody(messages);
    const vllmBody = vllmProvider.exposeBuildRequestBody(messages);

    expect(openRouterBody.model).toBe("openrouter/gpt-4o-mini");
    expect(aihubBody.model).toBe("openai/gpt-4o-mini");
    expect(aihubBody.provider).toBe("openai");
    expect(vllmBody.model).toBe("hosted_vllm/dashscope/qwen2.5");
  });

  it("openai provider parses tool calls from responses", async () => {
    const provider = new OpenAIProvider({
      apiBase: "https://api.openai.com/v1",
      apiKey: "test-key",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok",
              tool_calls: [
                {
                  id: "call-1",
                  function: { name: "calc", arguments: '{"x":1}' },
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await provider.generate([{ role: "user", content: "hi" }]);

    expect(response.toolCalls?.[0]).toEqual({
      id: "call-1",
      name: "calc",
      arguments: { x: 1 },
    });
  });

  it("openai provider handles invalid tool arguments gracefully", async () => {
    const provider = new OpenAIProvider({
      apiBase: "https://api.openai.com/v1",
      apiKey: "test-key",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok",
              tool_calls: [
                {
                  id: "call-2",
                  function: { name: "calc", arguments: "{bad json}" },
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await provider.generate([{ role: "user", content: "hi" }]);

    expect(response.toolCalls?.[0]).toEqual({
      id: "call-2",
      name: "calc",
      arguments: { raw: "{bad json}" },
    });
  });

  it("openai provider throws on non-ok responses", async () => {
    const provider = new OpenAIProvider({
      apiBase: "https://api.openai.com/v1",
      apiKey: "test-key",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    await expect(
      provider.generate([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("OpenAI API error: 401 Unauthorized");
  });

  it("builds headers with api key and extra headers", async () => {
    const provider = new OpenAIProvider({
      apiKey: "secret",
      extraHeaders: { "X-Custom": "yes" },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.generate([{ role: "user", content: "hi" }]);

    const headers = fetchMock.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer secret");
    expect(headers["X-Custom"]).toBe("yes");
  });

  it("litellm provider adds openrouter headers and target provider", () => {
    const provider = new TestLiteLLMProvider({
      apiKey: "sk-or-test",
      targetProvider: "openai",
      model: "gpt-4o-mini",
    });
    const body = provider.exposeBuildRequestBody([
      { role: "user", content: "hi" },
    ]);

    expect(body.provider).toBe("openai");
  });

  it("createProvider chooses mock when api key is missing", () => {
    const provider = createProvider({});
    expect(provider).toBeInstanceOf(MockProvider);
  });

  it("mock provider returns placeholder when no user content present", async () => {
    const provider = new MockProvider();
    const response = await provider.generate([
      { role: "assistant", content: "ok" } as any,
    ]);
    expect(response.content).toContain("(no user content)");
  });

  it("litellm uses explicit apiBase when provided", () => {
    const provider = new TestLiteLLMProvider({
      apiBase: "https://custom.example/v1",
    });
    expect((provider as any).apiBase).toBe("https://custom.example/v1");
  });

  it("litellm apiBase returns openrouter base when apiKey indicates openrouter", () => {
    const provider = new TestLiteLLMProvider({ apiKey: "sk-or-abc" });
    expect((provider as any).apiBase).toBe("https://openrouter.ai/api/v1");
  });

  it("litellm apiBase falls back to localhost when no hints", () => {
    const provider = new TestLiteLLMProvider({});
    expect((provider as any).apiBase).toBe("http://localhost:4000");
  });

  it("normalizeModelName leaves model unchanged when no env hints apply", () => {
    const provider = new TestLiteLLMProvider({ model: "plain-model" });
    const body = provider.exposeBuildRequestBody([
      { role: "user", content: "hi" },
    ]);
    expect(body.model).toBe("plain-model");
  });

  it("buildRequestBody maps message toolCalls and toolCallId and name", () => {
    const provider = new TestOpenAIProvider({ model: "gpt-test" });
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: "ok",
        toolCallId: "tc-1",
        name: "assistant-name",
        toolCalls: [{ id: "fid", name: "fn", arguments: { x: 2 } }],
      } as any,
    ];

    const body = provider.exposeBuildRequestBody(messages);
    const msg = (body.messages as any[])[0];
    expect(msg.tool_call_id).toBe("tc-1");
    expect(msg.name).toBe("assistant-name");
    expect(msg.tool_calls?.[0].function.name).toBe("fn");
  });

  it("openai provider parses tool arguments provided as objects", async () => {
    const provider = new OpenAIProvider({
      apiBase: "https://api.openai.com/v1",
      apiKey: "test-key",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok",
              tool_calls: [
                {
                  id: "call-3",
                  name: "calc",
                  arguments: { y: 2 },
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await provider.generate([{ role: "user", content: "hi" }]);
    expect(response.toolCalls?.[0]).toEqual({
      id: "call-3",
      name: "calc",
      arguments: { y: 2 },
    });
  });

  it("mock provider normalizes object content parts including images", async () => {
    const provider = new MockProvider();
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }, { type: "image" }] as any,
      },
    ];

    const response = await provider.generate(messages);

    expect(response.content).toContain("hello");
    expect(response.content).toContain("[image]");
  });

  it("litellm headers include openrouter defaults when openrouter detected", () => {
    const provider = new TestLiteLLMProvider({
      apiKey: "sk-or-xxx",
      model: "gpt-test",
    });
    const headers = (provider as any).buildHeaders();
    expect((headers as Record<string, string>)["HTTP-Referer"]).toBeDefined();
    expect((headers as Record<string, string>)["X-Title"]).toBeDefined();
  });

  it("keyword prefixes are applied for glm rule and skip when already prefixed", () => {
    const vllm = new TestLiteLLMProvider({
      apiBase: "http://localhost:8000",
      model: "glm-6b",
    });
    const body = vllm.exposeBuildRequestBody([{ role: "user", content: "hi" }]);
    expect(body.model).toBe("hosted_vllm/zai/glm-6b");

    const vllm2 = new TestLiteLLMProvider({
      apiBase: "http://localhost:8000",
      model: "zhipu/glm-6b",
    });
    const body2 = vllm2.exposeBuildRequestBody([
      { role: "user", content: "hi" },
    ]);
    expect(body2.model).toBe("hosted_vllm/zhipu/glm-6b");
  });

  it("createProvider selects openai and litellm based on config.type", () => {
    expect(createProvider({ provider: { apiKey: "k" } } as any)).toBeInstanceOf(
      OpenAIProvider,
    );
    expect(
      createProvider({ provider: { type: "litellm" } } as any),
    ).toBeInstanceOf(LiteLLMProvider);
  });

  it("mockProvider echos last user content and truncates long content", async () => {
    const p = new MockProvider();
    const long = "a".repeat(400);
    const msg: AgentMessage[] = [
      { role: "system", content: "sys" } as any,
      { role: "user", content: long } as any,
    ];
    const res = await p.generate(msg);
    expect(res.content).toContain("Echo (mock):");
    // truncated preview should end with ... when longer than 200
    expect(res.content).toContain("...");
  });

  it("openAIProvider throws on non-ok responses and returns toolCalls via parse", async () => {
    const provider = new OpenAIProvider({ apiBase: "https://api.test" });

    // mock fetch to simulate error
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Err",
      } as any),
    );
    await expect(provider.generate([] as any)).rejects.toThrow(
      "OpenAI API error: 500 Err",
    );

    // mock fetch success with tool_calls
    const resp = {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok",
              tool_calls: [
                { id: "1", function: { name: "f", arguments: '{"a":1}' } },
              ],
            },
          },
        ],
      }),
    } as any;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(resp));
    const result = await provider.generate([] as any);
    expect(result.content).toBe("ok");
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls?.[0].name).toBe("f");
  });

  it("liteLLMProvider normalizes model names and headers based on env hints", () => {
    // openrouter detection via apiKey prefix
    const p1 = new LiteLLMProvider({
      apiKey: "sk-or-abc",
      model: "gemini-large",
    });
    // apiBase getter should choose openrouter base when apiKey signals openrouter
    expect((p1 as any).apiBase).toContain("openrouter");
    const body = (p1 as any).buildRequestBody(
      [{ role: "user", content: "x" }],
      undefined,
    );
    // model should be a string (normalized), and include model name
    expect(typeof body.model).toBe("string");

    // ai hub mix behavior
    const p2 = new LiteLLMProvider({
      apiBase: "https://api.aihubmix.com/v1",
      model: "gpt",
    });
    const b2 = (p2 as any).buildRequestBody(
      [{ role: "user", content: "x" }],
      undefined,
    );
    expect(b2.provider).toBe("openai");

    // vllm detection when apiBase provided and not openrouter/aihubmix
    const p3 = new LiteLLMProvider({
      apiBase: "http://hosted-vllm.local",
      model: "qwen-1",
    });
    const b3 = (p3 as any).buildRequestBody(
      [{ role: "user", content: "x" }],
      undefined,
    );
    expect(typeof b3.model).toBe("string");
  });

  it("createProvider returns correct implementation based on config", () => {
    const fromOpen = createProvider({ provider: { apiKey: "sk-abc" } } as any);
    expect(fromOpen.constructor.name).toBe("OpenAIProvider");

    const fromMock = createProvider({ provider: {} } as any);
    expect(fromMock.constructor.name).toBe("MockProvider");
  });
});
