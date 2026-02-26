import { afterEach, describe, expect, it, vi } from "vitest";

import { WebFetchTool, WebSearchTool } from "../../../src/core/tools/web.ts";

function makeHeaders(contentType: string) {
  return {
    get: (key: string) =>
      key.toLowerCase() === "content-type" ? contentType : null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("web tools", () => {
  it("web_fetch extracts readability content as markdown", async () => {
    const html =
      "<!doctype html><html><head><title>Doc</title></head><body>" +
      '<article><h1>Heading</h1><p>Hello <a href="https://example.com">Link</a></p>' +
      "<ul><li>Item</li></ul></article></body></html>";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com",
        headers: makeHeaders("text/html; charset=utf-8"),
        text: async () => html,
      }),
    );

    const tool = new WebFetchTool();
    const result = await tool.execute({
      url: "https://example.com",
      extractMode: "markdown",
    });
    const payload = JSON.parse(result) as {
      extractor: string;
      text: string;
      truncated: boolean;
    };

    expect(payload.extractor).toBe("readability");
    expect(payload.truncated).toBe(false);
    expect(payload.text).toContain("#");
    expect(payload.text).toContain("Hello");
  });

  it("web_fetch falls back when readability returns no content", async () => {
    vi.doMock("@mozilla/readability", () => ({
      Readability: class {
        parse() {
          return null;
        }
      },
    }));
    const { WebFetchTool: MockedFetchTool } =
      await import("../../../src/core/tools/web.ts");

    const html =
      "<!doctype html><html><body><p>Hello fallback</p></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com",
        headers: makeHeaders("text/html"),
        text: async () => html,
      }),
    );

    const tool = new MockedFetchTool();
    const result = await tool.execute({
      url: "https://example.com",
      extractMode: "markdown",
    });
    const payload = JSON.parse(result) as { text: string };

    expect(payload.text).toContain("Hello fallback");
  });

  it("web_fetch falls back when readability content is empty", async () => {
    vi.doMock("@mozilla/readability", () => ({
      Readability: class {
        parse() {
          return { title: "Doc", content: "<div></div>" };
        }
      },
    }));
    const { WebFetchTool: MockedFetchTool } =
      await import("../../../src/core/tools/web.ts");

    const html = "<!doctype html><html><body><p>Hello empty</p></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com",
        headers: makeHeaders("text/html"),
        text: async () => html,
      }),
    );

    const tool = new MockedFetchTool();
    const result = await tool.execute({
      url: "https://example.com",
      extractMode: "markdown",
    });
    const payload = JSON.parse(result) as { text: string };

    expect(payload.text).toContain("Hello empty");
  });

  it("web_fetch handles json responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com/data",
        headers: makeHeaders("application/json"),
        text: async () => '{"ok":true}',
      }),
    );

    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "https://example.com/data" });
    const payload = JSON.parse(result) as { extractor: string; text: string };

    expect(payload.extractor).toBe("json");
    expect(payload.text).toBe('{\n  "ok": true\n}');
  });

  it("web_fetch preserves raw when json is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com/data",
        headers: makeHeaders("application/json"),
        text: async () => "{bad json}",
      }),
    );

    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "https://example.com/data" });
    const payload = JSON.parse(result) as { extractor: string; text: string };

    expect(payload.extractor).toBe("json");
    expect(payload.text).toBe("{bad json}");
  });

  it("web_fetch truncates large payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com/raw",
        headers: makeHeaders("text/plain"),
        text: async () => "x".repeat(120),
      }),
    );

    const tool = new WebFetchTool();
    const result = await tool.execute({
      url: "https://example.com/raw",
      maxChars: 100,
    });
    const payload = JSON.parse(result) as {
      truncated: boolean;
      length: number;
      text: string;
    };

    expect(payload.truncated).toBe(true);
    expect(payload.length).toBe(100);
    expect(payload.text).toBe("x".repeat(100));
  });

  it("web_fetch falls back when extracted text is empty", async () => {
    const html = "<!doctype html><html><body><script>1</script></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com/empty",
        headers: makeHeaders("text/html"),
        text: async () => html,
      }),
    );

    const tool = new WebFetchTool();
    const result = await tool.execute({
      url: "https://example.com/empty",
      extractMode: "markdown",
    });
    const payload = JSON.parse(result) as { extractor: string; text: string };

    expect(payload.extractor).toBe("readability");
    expect(payload.text).toBe("");
  });

  it("web_fetch rejects invalid urls", async () => {
    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "ftp://example.com" });
    const payload = JSON.parse(result) as { error: string };

    expect(payload.error).toContain("URL validation failed");
  });

  it("web_fetch rejects malformed urls", async () => {
    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "http://" });
    const payload = JSON.parse(result) as { error: string };

    expect(payload.error).toContain("URL validation failed");
  });

  it("web_fetch reports fetch timeout errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue({ name: "AbortError" }));

    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "https://example.com" });
    const payload = JSON.parse(result) as { error: string };

    expect(payload.error).toContain("request timed out");
  });

  it("web_search returns api errors when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "bad",
      }),
    );

    const tool = new WebSearchTool();
    const result = await tool.execute({ query: "tinybot" });

    expect(result).toContain("DuckDuckGo API 500");
  });

  it("web_search formats results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Heading: "One",
          AbstractText: "First",
          AbstractURL: "https://one",
          RelatedTopics: [{ Text: "Two - second", FirstURL: "https://two" }],
        }),
      }),
    );

    const tool = new WebSearchTool();
    const result = await tool.execute({ query: "tinybot", count: 2 });

    expect(result).toContain("Results for: tinybot");
    expect(result).toContain("1. One");
    expect(result).toContain("https://one");
    expect(result).toContain("First");
    expect(result).toContain("2. Two");
  });

  it("web_search handles nested RelatedTopics with Name/Topics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          RelatedTopics: [
            {
              Name: "Group",
              Topics: [
                { Text: "Nested - one", FirstURL: "https://n1" },
                { Text: "Nested - two", FirstURL: "https://n2" },
              ],
            },
          ],
        }),
      }),
    );

    const tool = new WebSearchTool({ maxResults: 3 });
    const result = await tool.execute({ query: "tinybot", count: 3 });

    expect(result).toContain("Results for: tinybot");
    expect(result).toContain("Nested");
    expect(result).toContain("https://n1");
  });

  it("web_search reports timeout errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue({ name: "AbortError" }));

    const tool = new WebSearchTool();
    const result = await tool.execute({ query: "tinybot" });

    expect(result).toContain("request timed out");
  });

  it("returns No results when payload has no entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );

    const tool = new WebSearchTool({ maxResults: 3 });
    const res = await tool.execute({ query: "nothing" });
    expect(res).toBe("No results for: nothing");
  });

  it("skips RelatedTopics items with empty Text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          RelatedTopics: [
            { Text: "   " },
            { Text: "Good - one", FirstURL: "https://g" },
          ],
        }),
      }),
    );

    const tool = new WebSearchTool({ maxResults: 2 });
    const res = await tool.execute({ query: "tiny" });

    expect(res).toContain("1.");
    expect(res).toContain("Good");
    expect(res).toContain("https://g");
  });

  it("handles nested Topics where some topic.Text are empty and limits by count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          RelatedTopics: [
            {
              Name: "Group",
              Topics: [
                { Text: "First - x", FirstURL: "https://a" },
                { Text: "   ", FirstURL: "https://b" },
                { Text: "Second - y", FirstURL: "https://c" },
              ],
            },
          ],
        }),
      }),
    );

    const tool = new WebSearchTool({ maxResults: 2 });
    const res = await tool.execute({ query: "nested", count: 2 });

    expect(res).toContain("1.");
    expect(res).toContain("First");
    expect(res).toContain("2.");
    expect(res).toContain("Second");
  });
});
