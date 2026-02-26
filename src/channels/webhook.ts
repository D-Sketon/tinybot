import type {
  InboundMessage,
  MessageBus,
  OutboundMessage,
} from "../core/bus.ts";
import { consola } from "consola";

interface WebhookChannelOptions {
  port: number;
  host: string;
  secret?: string;
  waitTimeoutMs: number;
}

interface PendingWaiter {
  deliver: (message: OutboundMessage | null) => void;
}

interface InboundPayload {
  channel?: string;
  chatId?: string;
  senderId?: string;
  content?: string;
  media?: string[];
  metadata?: Record<string, unknown>;
}

const JSON_HEADERS = {
  "content-type": "application/json",
};

/**
 * Exposes HTTP endpoints that enqueue inbound messages and optionally wait for replies.
 */
export class WebhookChannel {
  private server?: ReturnType<typeof Bun.serve>;
  private readonly replyQueues = new Map<string, OutboundMessage[]>();
  private readonly waiters = new Map<string, PendingWaiter[]>();
  private readonly channelHandlers = new Map<
    string,
    (message: OutboundMessage) => Promise<void>
  >();
  private running = false;
  private listeningAddress?: string;

  constructor(
    private readonly bus: MessageBus,
    private readonly options: WebhookChannelOptions,
  ) {
    this.ensureSubscribed("webhook");
  }

  /**
   * Starts the Bun HTTP server for webhook and health endpoints.
   */
  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = Bun.serve({
      port: this.options.port,
      hostname: this.options.host,
      fetch: (request) => this.handleRequest(request),
    });
    this.running = true;
    const host =
      this.options.host === "0.0.0.0" ? "127.0.0.1" : this.options.host;
    this.listeningAddress = `http://${host}:${this.options.port}`;

    consola.info(
      `webhook channel listening on http://${this.options.host}:${this.options.port}`,
    );
  }

  /**
   * Stops the HTTP server and unsubscribes outbound listeners.
   */
  async stop(): Promise<void> {
    const unsubscribe = (
      this.bus as MessageBus & {
        unsubscribeOutbound?: (
          channel: string,
          callback: (msg: OutboundMessage) => Promise<void>,
        ) => void;
      }
    ).unsubscribeOutbound;

    for (const [channel, handler] of this.channelHandlers.entries()) {
      unsubscribe?.call(this.bus, channel, handler);
    }
    this.channelHandlers.clear();

    this.server?.stop();
    this.server = undefined;
    this.running = false;
    this.listeningAddress = undefined;
  }

  /**
   * Reports whether the webhook server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Returns the inbound endpoint URL when the server is running.
   */
  describe(): string | null {
    if (!this.listeningAddress) {
      return null;
    }
    return `${this.listeningAddress}/inbound`;
  }

  private async handleRequest(request: Request): Promise<Response> {
    if (!this.authorize(request)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: JSON_HEADERS,
      });
    }

    if (request.method === "POST" && url.pathname === "/inbound") {
      return this.handleInboundRequest(request, url);
    }

    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }

  private async handleInboundRequest(
    request: Request,
    url: URL,
  ): Promise<Response> {
    let payload: InboundPayload;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    if (!payload.content || typeof payload.content !== "string") {
      return new Response(JSON.stringify({ error: "content_required" }), {
        status: 422,
        headers: JSON_HEADERS,
      });
    }

    const inbound: InboundMessage = {
      channel: payload.channel?.trim() || "webhook",
      chatId: payload.chatId?.trim() || "webhook:default",
      senderId: payload.senderId?.trim() || "webhook-user",
      content: payload.content,
      media: payload.media,
      metadata: payload.metadata,
    };

    this.ensureSubscribed(inbound.channel);

    await this.bus.publishInbound(inbound);

    const waitParam = url.searchParams.get("wait");
    const shouldWait = waitParam !== "false";
    const reply = shouldWait
      ? await this.waitForReply(inbound.channel, inbound.chatId)
      : null;

    return new Response(JSON.stringify({ status: "queued", reply }), {
      headers: JSON_HEADERS,
    });
  }

  private authorize(request: Request): boolean {
    if (!this.options.secret) {
      return true;
    }
    const header = request.headers.get("x-tinybot-secret");
    return header === this.options.secret;
  }

  private ensureSubscribed(channel: string): void {
    if (!channel || this.channelHandlers.has(channel)) {
      return;
    }

    const handler = async (message: OutboundMessage) => {
      this.pushReply(message);
    };

    this.channelHandlers.set(channel, handler);
    this.bus.subscribeOutbound(channel, handler);
  }

  private key(channel: string, chatId: string): string {
    return `${channel}:${chatId}`;
  }

  private pushReply(message: OutboundMessage): void {
    const key = this.key(message.channel, message.chatId);
    const queue = this.replyQueues.get(key) ?? [];
    queue.push(message);
    this.replyQueues.set(key, queue);

    const waiting = this.waiters.get(key);
    if (waiting?.length) {
      const pending = waiting.shift();
      if (pending) {
        pending.deliver(queue.shift()!);
      }
      if (!waiting.length) {
        this.waiters.delete(key);
      } else {
        this.waiters.set(key, waiting);
      }
    }
  }

  private waitForReply(
    channel: string,
    chatId: string,
  ): Promise<OutboundMessage | null> {
    const key = this.key(channel, chatId);
    const existing = this.replyQueues.get(key);
    if (existing && existing.length) {
      return Promise.resolve(existing.shift()!);
    }
    return new Promise((complete) => {
      let waiter: PendingWaiter;

      const timer = setTimeout(() => {
        this.removeWaiter(key, waiter);
        complete(null);
      }, this.options.waitTimeoutMs);

      waiter = {
        deliver: (message) => {
          clearTimeout(timer);
          this.removeWaiter(key, waiter);
          complete(message);
        },
      };

      const waiters = this.waiters.get(key) ?? [];
      waiters.push(waiter);
      this.waiters.set(key, waiters);
    });
  }

  private removeWaiter(key: string, target: PendingWaiter): void {
    const waiters = this.waiters.get(key);
    if (!waiters) {
      return;
    }
    const filtered = waiters.filter((waiter) => waiter !== target);
    if (filtered.length) {
      this.waiters.set(key, filtered);
    } else {
      this.waiters.delete(key);
    }
  }
}
