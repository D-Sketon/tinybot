import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

interface SkillRequirements {
  bins?: string[];
  env?: string[];
}

interface SkillRecord {
  name: string;
  source: "workspace" | "builtin";
  path: string;
  description: string;
  always: boolean;
  available: boolean;
  requires?: SkillRequirements | null;
  missing: string[];
}

interface ParsedSkillMeta {
  description: string;
  always: boolean;
  requires?: SkillRequirements | null;
}

/**
 * Discovers workspace and built-in skills and renders prompt-ready summaries.
 */
export class SkillsStore {
  private readonly workspaceSkillsPath: string;
  private readonly builtinSkillsPath?: string;
  private summaryCache: string | null = null;
  private signatureCache: string | null = null;

  constructor(
    private readonly workspacePath: string,
    builtinSkillsPath?: string,
  ) {
    this.workspaceSkillsPath = path.join(workspacePath, "skills");
    this.builtinSkillsPath = builtinSkillsPath;
  }

  /**
   * Builds a cached skills context that includes active content and discoverable catalog entries.
   */
  buildSummary(): string {
    const signature = this.computeSignature();
    if (this.summaryCache && this.signatureCache === signature) {
      return this.summaryCache;
    }

    const skills = this.collectSkills();
    if (!skills.length) {
      this.summaryCache = "";
      this.signatureCache = signature;
      return "";
    }

    const summary = this.composeContext(skills);
    this.summaryCache = summary;
    this.signatureCache = signature;
    return summary;
  }

  private composeContext(skills: SkillRecord[]): string {
    const sections: string[] = [];
    const active = this.renderActiveSkills(skills);
    if (active) {
      sections.push(active);
    }
    const catalog = this.renderSkillsSummary(skills);
    if (catalog) {
      sections.push(catalog);
    }
    return sections.join("\n\n");
  }

  private renderActiveSkills(skills: SkillRecord[]): string {
    const alwaysSkills = skills.filter(
      (skill) => skill.always && skill.available,
    );
    if (!alwaysSkills.length) {
      return "";
    }
    const blocks = alwaysSkills
      .map((skill) => {
        const body = this.readSkillBody(skill.path);
        if (!body) return null;
        return `## ${skill.name} (${skill.source})\n\n${body}`;
      })
      .filter((block): block is string => Boolean(block));
    if (!blocks.length) {
      return "";
    }
    return `# Active Skills\n\n${blocks.join("\n\n---\n\n")}`;
  }

  private renderSkillsSummary(skills: SkillRecord[]): string {
    const lines: string[] = ["<skills>"];
    for (const skill of skills) {
      lines.push(
        `  <skill name="${this.escapeXml(skill.name)}" source="${skill.source}" available="${skill.available}">`,
      );
      lines.push(
        `    <description>${this.escapeXml(skill.description)}</description>`,
      );
      lines.push(`    <location>${this.escapeXml(skill.path)}</location>`);
      if (!skill.available && skill.missing.length) {
        lines.push(
          `    <requires>${this.escapeXml(skill.missing.join(", "))}</requires>`,
        );
      }
      lines.push("  </skill>");
    }
    lines.push("</skills>");
    return `# Available Skills\n\n${lines.join("\n")}`;
  }

  private collectSkills(): SkillRecord[] {
    const skills: SkillRecord[] = [];
    const seen = new Set<string>();

    for (const record of this.scanDirectory(
      this.workspaceSkillsPath,
      "workspace",
    )) {
      skills.push(record);
      seen.add(record.name);
    }

    const builtinPath = this.getBuiltinSkillsPath();
    if (builtinPath) {
      for (const record of this.scanDirectory(builtinPath, "builtin")) {
        if (seen.has(record.name)) continue;
        skills.push(record);
      }
    }

    return skills;
  }

  private scanDirectory(
    dir: string,
    source: SkillRecord["source"],
  ): SkillRecord[] {
    const resolved = path.resolve(dir);
    if (!existsSync(resolved)) {
      return [];
    }

    const entries = readdirSync(resolved, { withFileTypes: true });
    const skills: SkillRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(resolved, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const meta = this.extractMetadata(skillFile);
      const availability = this.evaluateRequirements(
        meta.requires ?? undefined,
      );
      skills.push({
        name: entry.name,
        source,
        path: skillFile,
        description: meta.description,
        always: meta.always,
        requires: meta.requires ?? null,
        available: availability.available,
        missing: availability.missing,
      });
    }
    return skills;
  }

  private extractMetadata(skillFile: string): ParsedSkillMeta {
    try {
      const content = readFileSync(skillFile, "utf-8");
      const { frontmatter, body } = this.splitFrontmatter(content);
      const metadata = this.parseMetadata(frontmatter.metadata);
      const description =
        frontmatter.description?.trim() ||
        this.firstMeaningfulLine(body) ||
        "(no description)";
      const always =
        this.parseBoolean(frontmatter.always) ?? Boolean(metadata.always);
      const requires = this.normalizeRequirements(metadata.requires);
      return {
        description,
        always,
        requires,
      };
    } catch {
      return {
        description: "(unreadable skill)",
        always: false,
      };
    }
  }

  private splitFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    if (!content.startsWith("---")) {
      return { frontmatter: {}, body: content };
    }
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) {
      return { frontmatter: {}, body: content };
    }
    const raw = match[1] ?? "";
    const body = content.slice(match[0].length);
    const frontmatter: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const index = line.indexOf(":");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) {
        frontmatter[key] = value;
      }
    }
    return { frontmatter, body };
  }

  private parseMetadata(raw?: string): Record<string, any> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.tinybot) {
        return parsed.tinybot;
      }
      return parsed ?? {};
    } catch {
      return {};
    }
  }

  private normalizeRequirements(
    input?: SkillRequirements | null,
  ): SkillRequirements | null {
    if (!input) return null;
    const bins = Array.isArray(input.bins)
      ? input.bins.filter((bin) => typeof bin === "string" && bin.trim())
      : undefined;
    const env = Array.isArray(input.env)
      ? input.env.filter((name) => typeof name === "string" && name.trim())
      : undefined;
    if ((!bins || !bins.length) && (!env || !env.length)) {
      return null;
    }
    return {
      bins,
      env,
    };
  }

  private evaluateRequirements(requires?: SkillRequirements | null): {
    available: boolean;
    missing: string[];
  } {
    if (!requires) {
      return { available: true, missing: [] };
    }
    const missing: string[] = [];
    for (const bin of requires.bins ?? []) {
      if (!this.binaryExists(bin)) {
        missing.push(`CLI: ${bin}`);
      }
    }
    for (const env of requires.env ?? []) {
      if (!process.env[env]) {
        missing.push(`ENV: ${env}`);
      }
    }
    return { available: missing.length === 0, missing };
  }

  private readSkillBody(skillFile: string): string | null {
    try {
      const content = readFileSync(skillFile, "utf-8");
      const { body } = this.splitFrontmatter(content);
      return body.trim();
    } catch {
      return null;
    }
  }

  private firstMeaningfulLine(content: string): string | null {
    for (const line of content.split(/\r?\n/)) {
      if (line.trim()) {
        return line.trim();
      }
    }
    return null;
  }

  private parseBoolean(value?: string): boolean | null {
    if (value === undefined) return null;
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
    return null;
  }

  private binaryExists(bin: string): boolean {
    return Boolean(Bun.which(bin));
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private computeSignature(): string {
    const parts: string[] = [];
    const collect = (dir: string, label: string) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = path.join(dir, entry.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        try {
          const stats = statSync(skillFile);
          parts.push(`${label}:${entry.name}:${stats.mtimeMs}:${stats.size}`);
        } catch {
          parts.push(`${label}:${entry.name}:error`);
        }
      }
    };

    collect(this.workspaceSkillsPath, "workspace");
    const builtinPath = this.getBuiltinSkillsPath();
    if (builtinPath) {
      collect(builtinPath, "builtin");
    }
    return parts.sort().join("|") || "empty";
  }

  private getBuiltinSkillsPath(): string | null {
    if (!this.builtinSkillsPath) return null;
    const resolved = path.resolve(this.builtinSkillsPath);
    if (!existsSync(resolved)) return null;
    if (resolved === path.resolve(this.workspaceSkillsPath)) return null;
    return resolved;
  }
}
