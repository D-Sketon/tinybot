import type { ToolSchema } from "./base.ts";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { asOptionalString, BaseTool } from "./base.ts";

interface WebSearchOptions {
  maxResults?: number;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36";
const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_SEARCH_RESULTS = 5;
const SEARCH_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 30_000;

const HTML_TAG_REGEX = /<[^>]+>/g;
const SCRIPT_TAG_REGEX = /<script[\s\S]*?<\/script>/gi;
const STYLE_TAG_REGEX = /<style[\s\S]*?<\/style>/gi;
const MULTI_NEWLINE_REGEX = /\n{3,}/g;

/**
 * Normalizes spacing and collapses excessive blank lines.
 */
function normalizeWhitespace(value: string): string {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(MULTI_NEWLINE_REGEX, "\n\n")
    .trim();
}

function decodeEntities(value: string): string {
  const { document } = parseHTML(
    `<!doctype html><html><body>${value}</body></html>`,
  );
  return document.body?.textContent ?? "";
}

function stripTags(value: string): string {
  const withoutScripts = value
    .replace(SCRIPT_TAG_REGEX, "")
    .replace(STYLE_TAG_REGEX, "");
  const withoutTags = withoutScripts.replace(HTML_TAG_REGEX, "");
  return decodeEntities(withoutTags).trim();
}

function toMarkdown(html: string): string {
  let text = html.replace(
    /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, label: string) => `[${stripTags(label)}](${href})`,
  );
  text = text.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level: string, heading: string) =>
      `\n${"#".repeat(Number(level))} ${stripTags(heading)}\n`,
  );
  text = text.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, item: string) => `\n- ${stripTags(item)}`,
  );
  text = text.replace(/<\/(p|div|section|article)>/gi, "\n\n");
  text = text.replace(/<(br|hr)\s*\/?>(?=\s|$)/gi, "\n");
  return normalizeWhitespace(stripTags(text));
}

function isHtmlContent(raw: string, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes("text/html")) return true;
  const head = raw.slice(0, 256).trim().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

function extractContent(html: string, mode: "text" | "markdown"): string {
  return mode === "markdown"
    ? toMarkdown(html)
    : normalizeWhitespace(stripTags(html));
}

function extractReadable(html: string, mode: "text" | "markdown"): string {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();
  if (!article?.content) {
    return extractContent(html, mode);
  }
  const body = extractContent(article?.content, mode);
  if (!body) {
    return extractContent(html, mode);
  }
  return article.title ? `# ${article.title}\n\n${body}` : body;
}

function validateUrl(rawUrl: string): { ok: boolean; error?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        error: `Only http/https allowed, got '${parsed.protocol || "none"}'`,
      };
    }
    if (!parsed.hostname) return { ok: false, error: "Missing domain" };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Fetches a URL and returns extracted readable content.
 */
export class WebFetchTool extends BaseTool {
  override readonly name = "web_fetch";
  override readonly description =
    "Fetch URL and extract readable content (HTML to markdown/text).";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        extractMode: {
          type: "string",
          enum: ["markdown", "text"],
        },
        maxChars: { type: "integer", minimum: 100 },
      },
      required: ["url"],
    },
  };

  /**
   * Fetches and extracts page content as markdown or text.
   */
  async execute(rawArgs: Record<string, unknown>): Promise<string> {
    const url = asOptionalString(rawArgs.url);
    if (!url) throw new Error("url is required");

    const extractMode = rawArgs.extractMode === "text" ? "text" : "markdown";
    const maxChars =
      typeof rawArgs.maxChars === "number" && rawArgs.maxChars >= 100
        ? Math.round(rawArgs.maxChars)
        : DEFAULT_MAX_CHARS;

    const validation = validateUrl(url);
    if (!validation.ok) {
      return JSON.stringify({
        error: `URL validation failed: ${validation.error}`,
        url,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });

      const raw = await response.text();
      const contentType = response.headers.get("content-type") ?? "";

      let text = raw;
      let extractor = "raw";

      if (contentType.includes("application/json")) {
        try {
          text = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          text = raw;
        }
        extractor = "json";
      } else if (isHtmlContent(raw, contentType)) {
        text = extractReadable(raw, extractMode);
        extractor = "readability";
      }

      if (!text.trim()) {
        text = isHtmlContent(raw, contentType)
          ? extractContent(raw, extractMode)
          : raw;
      }

      const truncated = text.length > maxChars;
      if (truncated) text = text.slice(0, maxChars);

      return JSON.stringify({
        url,
        finalUrl: response.url,
        status: response.status,
        extractor,
        truncated,
        length: text.length,
        text,
      });
    } catch (error) {
      const reason =
        (error as Error).name === "AbortError"
          ? `request timed out after ${FETCH_TIMEOUT_MS}ms`
          : (error as Error).message;
      return JSON.stringify({ error: reason, url });
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Queries DuckDuckGo and formats lightweight search results.
 */
export class WebSearchTool extends BaseTool {
  override readonly name = "web_search";
  override readonly description =
    "Search the public web via DuckDuckGo Instant Answer API.";
  override readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: {
          type: "integer",
          description: "Results (1-10)",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["query"],
    },
  };

  private readonly maxResults: number;

  constructor(options: WebSearchOptions = {}) {
    super();
    this.maxResults = options.maxResults ?? DEFAULT_SEARCH_RESULTS;
  }

  /**
   * Executes a web search and returns up to the requested number of results.
   */
  async execute(rawArgs: Record<string, unknown>): Promise<string> {
    const query = asOptionalString(rawArgs.query)?.trim();
    if (!query) throw new Error("query is required");

    const count =
      typeof rawArgs.count === "number" &&
      rawArgs.count >= 1 &&
      rawArgs.count <= 10
        ? Math.round(rawArgs.count)
        : Math.min(Math.max(this.maxResults, 1), 10);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const params = new URLSearchParams({ q: query, count: String(count) });
      const response = await fetch(
        `https://api.duckduckgo.com/?${params.toString()}&format=json&no_html=1&skip_disambig=1`,
        {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        },
      );

      if (!response.ok) {
        const body = await response.text();
        return `Error: DuckDuckGo API ${response.status}: ${body.slice(0, 400)}`;
      }

      const payload = (await response.json()) as {
        Heading?: string;
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<
          | {
              Text?: string;
              FirstURL?: string;
            }
          | {
              Name?: string;
              Topics?: Array<{
                Text?: string;
                FirstURL?: string;
              }>;
            }
        >;
      };

      const results: Array<{
        title: string;
        url: string;
        description: string;
      }> = [];

      if (payload.AbstractText?.trim()) {
        results.push({
          title: payload.Heading?.trim() || "DuckDuckGo Answer",
          url: payload.AbstractURL?.trim() || "",
          description: payload.AbstractText.trim(),
        });
      }

      const related = payload.RelatedTopics ?? [];
      for (const item of related) {
        if (results.length >= count) break;
        if ("Topics" in item && Array.isArray(item.Topics)) {
          for (const topic of item.Topics) {
            if (results.length >= count) break;
            if (!topic.Text?.trim()) continue;
            results.push({
              title: topic.Text.trim().split(" - ")[0] || "DuckDuckGo Result",
              url: topic.FirstURL?.trim() || "",
              description: topic.Text.trim(),
            });
          }
          continue;
        }

        const text = (item as { Text?: string }).Text?.trim();
        if (!text) continue;
        results.push({
          title: text.split(" - ")[0] || "DuckDuckGo Result",
          url: (item as { FirstURL?: string }).FirstURL?.trim() || "",
          description: text,
        });
      }

      if (!results.length) return `No results for: ${query}`;

      const lines = results.slice(0, count).map((item, index) => {
        const title = item.title || "Untitled";
        const url = item.url;
        const description = item.description;
        return `${index + 1}. ${title}\n   ${url}${description ? `\n   ${description}` : ""}`;
      });

      return `Results for: ${query}\n\n${lines.join("\n")}`;
    } catch (error) {
      const reason =
        (error as Error).name === "AbortError"
          ? `request timed out after ${SEARCH_TIMEOUT_MS}ms`
          : (error as Error).message;
      return `Error: ${reason}`;
    } finally {
      clearTimeout(timeout);
    }
  }
}
