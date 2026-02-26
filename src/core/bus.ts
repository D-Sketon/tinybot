import { consola } from "consola";

export interface InboundMessage {
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  media?: string[];
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  media?: string[];
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

class AsyncMessageQueue<T> {
  private queue: T[] = [];
  private waiters: Array<(value: T | null) => void> = [];
  private closed = false;

  enqueue(item: T) {
    if (this.closed) return;
    if (this.waiters.length) {
      const resolve = this.waiters.shift()!;
      resolve(item);
      return;
    }
    this.queue.push(item);
  }

  dequeue(): Promise<T | null> {
    if (this.queue.length) {
      return Promise.resolve(this.queue.shift()!);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close() {
    this.closed = true;
    const waiters = [...this.waiters];
    this.waiters.length = 0;
    for (const resolve of waiters) {
      resolve(null);
    }
  }

  size(): number {
    return this.queue.length;
  }
}

/**
 * Routes inbound and outbound messages between the agent loop and channel handlers.
 */
export class MessageBus {
  private inboundQueue = new AsyncMessageQueue<InboundMessage>();
  private outboundQueue = new AsyncMessageQueue<OutboundMessage>();
  private subscribers = new Map<
    string,
    Set<(msg: OutboundMessage) => Promise<void>>
  >();
  private running = false;

  /**
   * Enqueues an inbound message for agent consumption.
   */
  async publishInbound(message: InboundMessage) {
    this.inboundQueue.enqueue(message);
  }

  /**
   * Dequeues the next inbound message or null when the queue is closed.
   */
  async consumeInbound(): Promise<InboundMessage | null> {
    return this.inboundQueue.dequeue();
  }

  /**
   * Enqueues an outbound message for channel dispatch.
   */
  async publishOutbound(message: OutboundMessage) {
    this.outboundQueue.enqueue(message);
  }

  subscribeOutbound(
    channel: string,
    callback: (msg: OutboundMessage) => Promise<void>,
  ) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(callback);
  }

  unsubscribeOutbound(
    channel: string,
    callback: (msg: OutboundMessage) => Promise<void>,
  ) {
    const handlers = this.subscribers.get(channel);
    if (handlers) {
      handlers.delete(callback);
    }
  }

  /**
   * Runs the outbound dispatch loop and forwards messages to subscribed handlers.
   */
  async dispatchOutbound() {
    if (this.running) return;
    this.running = true;

    while (this.running) {
      const message = await this.outboundQueue.dequeue();
      if (!message) {
        if (!this.running) break;
        continue;
      }
      const handlers = this.subscribers.get(message.channel) ?? [];
      for (const handler of handlers) {
        try {
          await handler(message);
        } catch (error) {
          consola.warn(
            `Failed to deliver message to ${message.channel}: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Stops dispatching and closes both inbound and outbound queues.
   */
  stopDispatch() {
    this.running = false;
    this.inboundQueue.close();
    this.outboundQueue.close();
  }

  get inboundSize(): number {
    return this.inboundQueue.size();
  }

  get outboundSize(): number {
    return this.outboundQueue.size();
  }
}
