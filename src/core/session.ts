import type { AgentMessage } from "./context.ts";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_HISTORY_LIMIT = 40;

export interface Session {
  id: string;
  messages: AgentMessage[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface PersistedMessage extends AgentMessage {
  timestamp?: string;
}

interface PersistedSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  messages: PersistedMessage[];
}

/**
 * Loads, normalizes, and persists per-session conversation history.
 */
export class SessionManager {
  private readonly sessionsDir: string;

  constructor(
    workspace: string,
    private readonly historyLimit = DEFAULT_HISTORY_LIMIT,
  ) {
    this.sessionsDir = path.join(workspace, "sessions");
  }

  /**
   * Returns an existing session or creates a new empty session.
   */
  async getOrCreate(sessionKey: string): Promise<Session> {
    await mkdir(this.sessionsDir, { recursive: true }).catch(() => {});
    const filePath = this.sessionPath(sessionKey);

    try {
      const data = await readFile(filePath, "utf8");
      return this.parseSession(data, sessionKey);
    } catch {
      return this.createEmptySession(sessionKey);
    }
  }

  /**
   * Persists session state with clamped history and metadata timestamps.
   */
  async save(session: Session): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true }).catch(() => {});
    const filePath = this.sessionPath(session.id);
    const prepared = this.prepareForPersist(session);
    await writeFile(filePath, JSON.stringify(prepared, null, 2), "utf8");
  }

  /**
   * Lists persisted sessions with lightweight metadata for discovery.
   */
  async listSessions(): Promise<
    Array<{ id: string; updatedAt: string; messageCount: number }>
  > {
    await mkdir(this.sessionsDir, { recursive: true }).catch(() => {});
    const names = await readdir(this.sessionsDir).catch(() => [] as string[]);
    const sessionFiles = names.filter((name) => name.endsWith(".json"));
    const records = await Promise.all(
      sessionFiles.map(async (name) => {
        const filePath = path.join(this.sessionsDir, name);
        try {
          const data = await readFile(filePath, "utf8");
          const parsed = this.parsePersistedSession(data);
          if (!parsed) return null;
          return {
            id: parsed.id,
            updatedAt: parsed.updatedAt,
            messageCount: parsed.messages.length,
          };
        } catch {
          return null;
        }
      }),
    );

    return records
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Returns recent messages for an existing session or null when missing.
   */
  async getHistory(
    sessionKey: string,
    limit = 20,
  ): Promise<AgentMessage[] | null> {
    if (limit <= 0) return [];
    const filePath = this.sessionPath(sessionKey);

    let payload: string;
    try {
      payload = await readFile(filePath, "utf8");
    } catch {
      return null;
    }

    const parsed = this.parsePersistedSession(payload);
    if (!parsed) {
      return null;
    }

    const messages = parsed.messages.map((message) =>
      this.stripTimestamp(message),
    );
    return messages.length > limit
      ? messages.slice(messages.length - limit)
      : messages;
  }

  private sessionPath(sessionKey: string): string {
    const safeKey = sessionKey.replace(/[:/\\]/g, "_");
    return path.join(this.sessionsDir, `${safeKey}.json`);
  }

  private parseSession(payload: string, sessionKey: string): Session {
    try {
      const parsed: PersistedSession | AgentMessage[] = JSON.parse(payload);

      if (Array.isArray(parsed)) {
        return this.createSession(sessionKey, parsed);
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.messages)
      ) {
        const messages = parsed.messages.map((message) =>
          this.stripTimestamp(message),
        );
        return {
          id: sessionKey,
          messages: this.clampHistory(messages),
          metadata: parsed.metadata ?? {},
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        };
      }
    } catch {
      // fall through to default session
    }

    return this.createEmptySession(sessionKey);
  }

  private parsePersistedSession(payload: string): PersistedSession | null {
    try {
      const parsed: PersistedSession | AgentMessage[] = JSON.parse(payload);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      if (!Array.isArray(parsed.messages)) {
        return null;
      }
      return {
        id: parsed.id ?? "unknown",
        createdAt: parsed.createdAt ?? new Date().toISOString(),
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        metadata: parsed.metadata ?? {},
        messages: parsed.messages,
      };
    } catch {
      return null;
    }
  }

  private prepareForPersist(session: Session): PersistedSession {
    const now = new Date().toISOString();
    const createdAt = session.createdAt ?? now;
    const messages = this.clampHistory(session.messages);

    const persistedMessages: PersistedMessage[] = messages.map((message) => ({
      ...message,
      timestamp: (message as PersistedMessage).timestamp ?? now,
    }));

    session.messages = messages;
    session.createdAt = createdAt;
    session.updatedAt = now;

    return {
      id: session.id,
      createdAt,
      updatedAt: now,
      metadata: session.metadata ?? {},
      messages: persistedMessages,
    };
  }

  private stripTimestamp(message: PersistedMessage): AgentMessage {
    const { timestamp: _ts, ...rest } = message;
    return rest;
  }

  private clampHistory(messages: AgentMessage[]): AgentMessage[] {
    if (!messages.length) {
      return messages;
    }
    return messages.length > this.historyLimit
      ? messages.slice(messages.length - this.historyLimit)
      : messages;
  }

  private createSession(
    sessionKey: string,
    legacyMessages: AgentMessage[],
  ): Session {
    return {
      ...this.createEmptySession(sessionKey),
      messages: this.clampHistory(legacyMessages),
    };
  }

  private createEmptySession(sessionKey: string): Session {
    const now = new Date().toISOString();
    return {
      id: sessionKey,
      messages: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
  }
}
