import { Buffer } from "node:buffer";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const MAX_MEMORY_BYTES = 2_000_000; // guard against huge files
const MAX_CONTEXT_CHARS = 8_000; // cap what we send into the prompt
const DEFAULT_RECENT_DAYS = 3;

/**
 * Reads and writes long-term and daily memory notes within the workspace.
 */
export class MemoryStore {
  private memoryDir: string;
  private longTermPath: string;

  constructor(private workspacePath: string) {
    this.memoryDir = path.join(workspacePath, "memory");
    this.longTermPath = path.join(this.memoryDir, "MEMORY.md");
  }

  /**
   * Builds a bounded memory context string for prompt injection.
   */
  getMemoryContext(): string {
    const parts: string[] = [];

    const longTerm = this.readLongTerm();
    if (longTerm) {
      parts.push(`# Memory\n\n${longTerm}`);
    }

    const recent = this.getRecentMemories(DEFAULT_RECENT_DAYS);
    if (recent) {
      parts.push(recent);
    }

    const combined = parts.join("\n\n");
    return combined.length > MAX_CONTEXT_CHARS
      ? `${combined.slice(0, MAX_CONTEXT_CHARS)}\n\n[truncated memory]`
      : combined;
  }

  /**
   * Reads long-term memory content.
   */
  readLongTerm(): string | null {
    return this.safeRead(this.longTermPath);
  }

  /**
   * Writes long-term memory content with size safeguards.
   */
  writeLongTerm(content: string): void {
    this.ensureMemoryDir();
    if (Buffer.byteLength(content, "utf-8") > MAX_MEMORY_BYTES) {
      throw new Error("Memory content too large; refusing to write");
    }
    writeFileSync(this.longTermPath, content, "utf-8");
  }

  /**
   * Appends a timestamped note to the daily memory file.
   */
  appendDailyNote(content: string, date: Date | string = new Date()): void {
    this.ensureMemoryDir();
    const target = path.join(this.memoryDir, this.fileNameForDate(date));
    const stamp = new Date().toISOString();
    appendFileSync(target, `\n\n## ${stamp}\n\n${content}\n`);
  }

  /**
   * Reads the memory note for a specific day.
   */
  readDailyNote(date: Date | string = new Date()): string | null {
    const target = path.join(this.memoryDir, this.fileNameForDate(date));
    return this.safeRead(target);
  }

  /**
   * Lists markdown files present in the memory directory.
   */
  listMemoryFiles(): string[] {
    if (!existsSync(this.memoryDir)) return [];
    return readdirSync(this.memoryDir).filter((name) =>
      name.toLowerCase().endsWith(".md"),
    );
  }

  /**
   * Collects memory notes from recent days into one sectioned string.
   */
  getRecentMemories(days = DEFAULT_RECENT_DAYS): string {
    if (days <= 0) return "";
    const sections: string[] = [];
    const now = new Date();
    for (let offset = 0; offset < days; offset++) {
      const cursor = new Date(now);
      cursor.setDate(now.getDate() - offset);
      const contents = this.readDailyNote(cursor);
      if (!contents) continue;
      sections.push(
        `# ${cursor.toISOString().slice(0, 10)}\n\n${contents.trim()}`,
      );
    }
    return sections.join("\n\n");
  }

  private fileNameForDate(date: Date | string): string {
    const target =
      typeof date === "string" ? new Date(date) : new Date(date.getTime());
    if (Number.isNaN(target.getTime())) {
      throw new TypeError("Invalid date supplied for memory file access");
    }
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}.md`;
  }

  private ensureMemoryDir(): void {
    mkdirSync(this.memoryDir, { recursive: true });
  }

  private safeRead(target: string): string | null {
    if (!existsSync(target)) return null;
    const stats = statSync(target);
    if (!stats.isFile()) return null;
    if (stats.size > MAX_MEMORY_BYTES) return null;
    try {
      return readFileSync(target, "utf-8");
    } catch {
      return null;
    }
  }
}
