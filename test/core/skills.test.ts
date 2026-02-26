import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillsStore } from "../../src/core/skills.ts";

const { existsSyncMock, readdirSyncMock, readFileSyncMock, statSyncMock } =
  vi.hoisted(() => ({
    existsSyncMock: vi.fn(),
    readdirSyncMock: vi.fn(),
    readFileSyncMock: vi.fn(),
    statSyncMock: vi.fn(),
  }));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
  statSync: statSyncMock,
}));

const normalize = (value: string) => value.replace(/\\/g, "/");

describe("skillsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds summary with active and available skills", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const alphaPath = normalize(path.join(skillsDir, "alpha", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === alphaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "alpha", isDirectory: () => true },
    ]);
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === alphaPath) {
        return "---\ndescription: Alpha skill\nalways: true\n---\nDo alpha work.\n";
      }
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 1, size: 10 });

    const store = new SkillsStore(workspace);
    const summary = store.buildSummary();

    expect(summary).toContain("# Active Skills");
    expect(summary).toContain("## alpha (workspace)");
    expect(summary).toContain("Do alpha work.");
  });

  it("includes missing requirements for unavailable skills", () => {
    const whichMock = vi.fn().mockReturnValue(undefined);
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const betaPath = normalize(path.join(skillsDir, "beta", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === betaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "beta", isDirectory: () => true },
    ]);
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === betaPath) {
        return '---\nmetadata: {"requires":{"bins":["foo"],"env":["API_KEY"]}}\n---\nBeta skill.\n';
      }
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 2, size: 20 });

    const store = new SkillsStore(workspace);
    const summary = store.buildSummary();

    expect(summary).toContain('available="false"');
    expect(summary).toContain("CLI: foo");
    expect(summary).toContain("ENV: API_KEY");
  });

  it("returns empty summary when no skills are found", () => {
    const workspace = path.resolve("/workspace");
    existsSyncMock.mockReturnValue(false);

    const store = new SkillsStore(workspace);
    const summary = store.buildSummary();

    expect(summary).toBe("");
  });

  it("caches summaries when the signature is unchanged", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const alphaPath = normalize(path.join(skillsDir, "alpha", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === alphaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "alpha", isDirectory: () => true },
    ]);
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === alphaPath) {
        return "Alpha skill description.\n";
      }
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 1, size: 10 });

    const store = new SkillsStore(workspace);
    const first = store.buildSummary();
    const second = store.buildSummary();

    expect(first).toBe(second);
    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("skips builtin skills when the path matches workspace skills", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const alphaPath = normalize(path.join(skillsDir, "alpha", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === alphaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "alpha", isDirectory: () => true },
    ]);
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === alphaPath) {
        return "Alpha skill description.\n";
      }
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 1, size: 10 });

    const store = new SkillsStore(workspace, skillsDir);
    const summary = store.buildSummary();

    expect(summary).toContain("alpha");
    expect(readdirSyncMock).toHaveBeenCalledTimes(2);
  });

  it("computeSignature includes error when statSync throws", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const gammaPath = normalize(path.join(skillsDir, "gamma", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === gammaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "gamma", isDirectory: () => true },
    ]);
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === gammaPath) {
        return "---\ndescription: Gamma skill\n---\nGamma body\n";
      }
      return "";
    });
    statSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === gammaPath) throw new Error("stat error");
      return { mtimeMs: 1, size: 10 };
    });

    const store = new SkillsStore(workspace);
    const sig = (store as any).computeSignature();
    expect(sig).toContain(":error");
  });

  it("extractMetadata returns unreadable when readFileSync throws", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const deltaPath = normalize(path.join(skillsDir, "delta", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === deltaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "delta", isDirectory: () => true },
    ]);
    readFileSyncMock.mockImplementation(() => {
      throw new Error("cannot read");
    });
    statSyncMock.mockReturnValue({ mtimeMs: 3, size: 30 });

    const store = new SkillsStore(workspace);
    const summary = store.buildSummary();

    expect(summary).toContain("(unreadable skill)");
  });

  it("readSkillBody returns null when read fails", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const epsPath = normalize(path.join(skillsDir, "eps", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === epsPath;
    });
    readdirSyncMock.mockReturnValue([{ name: "eps", isDirectory: () => true }]);
    // make readFileSync throw for body reads
    readFileSyncMock.mockImplementation(() => {
      throw new Error("read fail");
    });
    statSyncMock.mockReturnValue({ mtimeMs: 4, size: 40 });

    const store = new SkillsStore(workspace);
    const body = (store as any).readSkillBody(epsPath);
    expect(body).toBeNull();
  });

  it("escapes xml in descriptions", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const zetaPath = normalize(path.join(skillsDir, "zeta", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === zetaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "zeta", isDirectory: () => true },
    ]);
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === zetaPath) {
        return "---\ndescription: a & b < c > d\n---\nZeta body\n";
      }
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 5, size: 50 });

    const store = new SkillsStore(workspace);
    const summary = store.buildSummary();
    expect(summary).toContain("&amp;");
    expect(summary).toContain("&lt;");
    expect(summary).toContain("&gt;");
  });

  it("parseBoolean handles various inputs", () => {
    const store = new SkillsStore(path.resolve("/workspace"));
    const fn = (store as any).parseBoolean.bind(store);
    expect(fn(undefined)).toBeNull();
    expect(fn("yes")).toBe(true);
    expect(fn("no")).toBe(false);
    expect(fn("1")).toBe(true);
    expect(fn("0")).toBe(false);
    expect(fn("TrUe")).toBe(true);
    // also cover unknown string -> null
    expect(fn("maybe")).toBeNull();
  });

  it("active skills with no body returns empty active block", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const omegaPath = normalize(path.join(skillsDir, "omega", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return target === skillsDir || target === omegaPath;
    });
    readdirSyncMock.mockReturnValue([
      { name: "omega", isDirectory: () => true },
    ]);
    // provide frontmatter that marks always via metadata but empty body
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === omegaPath) {
        return '---\nmetadata: {"always":true}\n---\n\n';
      }
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 6, size: 60 });

    const store = new SkillsStore(workspace);
    const summary = store.buildSummary();
    // active block should not appear because body is empty
    expect(summary).not.toContain("# Active Skills");
  });

  it("skips builtin skill when name already seen in workspace", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const builtinDir = normalize(path.join(workspace, "builtin_skills"));
    const alphaWsPath = normalize(path.join(skillsDir, "alpha", "SKILL.md"));
    const alphaBuiltinPath = normalize(
      path.join(builtinDir, "alpha", "SKILL.md"),
    );

    existsSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      return [skillsDir, builtinDir, alphaWsPath, alphaBuiltinPath].includes(
        target,
      );
    });
    readdirSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === skillsDir)
        return [{ name: "alpha", isDirectory: () => true }];
      if (target === builtinDir)
        return [{ name: "alpha", isDirectory: () => true }];
      return [];
    });
    readFileSyncMock.mockImplementation((p: string) => {
      const target = normalize(path.resolve(p));
      if (target === alphaWsPath) return "Alpha workspace\n";
      if (target === alphaBuiltinPath) return "Alpha builtin\n";
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 7, size: 70 });

    const store = new SkillsStore(workspace, builtinDir);
    const summary = store.buildSummary();
    // builtin alpha should be skipped because workspace already has alpha
    expect(summary).toContain("alpha");
    // readdir called for both workspace and builtin
    expect(readdirSyncMock).toHaveBeenCalled();
  });

  it("splitFrontmatter returns body when no closing delimiter", () => {
    const store = new SkillsStore(path.resolve("/workspace"));
    const input = "---\nnot closed";
    const result = (store as any).splitFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(input);
  });

  it("parseMetadata returns nested tinybot object when present", () => {
    const store = new SkillsStore(path.resolve("/workspace"));
    const raw = JSON.stringify({ tinybot: { requires: { bins: ["x"] } } });
    const parsed = (store as any).parseMetadata(raw);
    expect(parsed).toHaveProperty("requires");
  });

  it("normalizeRequirements filters invalid entries and returns null for empties", () => {
    const store = new SkillsStore(path.resolve("/workspace"));
    const fn = (store as any).normalizeRequirements.bind(store);
    const cleaned = fn({
      bins: ["", "git" as any],
      env: [undefined as any, "API"],
    });
    expect(cleaned).toEqual({ bins: ["git"], env: ["API"] });
    expect(fn({ bins: [], env: [] })).toBeNull();
  });

  it("firstMeaningfulLine returns null for blank content", () => {
    const store = new SkillsStore(path.resolve("/workspace"));
    const fn = (store as any).firstMeaningfulLine.bind(store);
    expect(fn("\n\n")).toBeNull();
  });

  it("computeSignature returns empty when no skills present", () => {
    existsSyncMock.mockReturnValue(false);
    const store = new SkillsStore(path.resolve("/workspace"));
    const sig = (store as any).computeSignature();
    expect(sig).toBe("empty");
  });

  it("getBuiltinSkillsPath returns resolved path when different and exists", () => {
    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const builtinDir = normalize(path.join(workspace, "other"));
    existsSyncMock.mockImplementation((p: string) => {
      const t = normalize(path.resolve(p));
      return t === skillsDir || t === builtinDir;
    });
    const store = new SkillsStore(workspace, builtinDir);
    const got = (store as any).getBuiltinSkillsPath();
    expect(got).toBe(path.resolve(builtinDir));
  });

  it("collectSkills skips builtin entries when name already seen (duplicate)", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });

    const workspace = path.resolve("/workspace");
    const skillsDir = normalize(path.join(workspace, "skills"));
    const builtinDir = normalize(path.join(workspace, "builtin"));
    const dupWs = normalize(path.join(skillsDir, "dup", "SKILL.md"));
    const dupBuiltin = normalize(path.join(builtinDir, "dup", "SKILL.md"));

    existsSyncMock.mockImplementation((p: string) => {
      const t = normalize(path.resolve(p));
      return [skillsDir, builtinDir, dupWs, dupBuiltin].includes(t);
    });
    readdirSyncMock.mockImplementation((p: string) => {
      const t = normalize(path.resolve(p));
      if (t === skillsDir) return [{ name: "dup", isDirectory: () => true }];
      if (t === builtinDir) return [{ name: "dup", isDirectory: () => true }];
      return [];
    });
    readFileSyncMock.mockImplementation((p: string) => {
      const t = normalize(path.resolve(p));
      if (t === dupWs) return "---\ndescription: ws\n---\nws body\n";
      if (t === dupBuiltin)
        return "---\ndescription: builtin\n---\nbuiltin body\n";
      return "";
    });
    statSyncMock.mockReturnValue({ mtimeMs: 8, size: 80 });

    const store = new SkillsStore(workspace, builtinDir);
    const skills = (store as any).collectSkills();
    // only one 'dup' should be present (workspace wins)
    expect(skills.filter((s: any) => s.name === "dup").length).toBe(1);
  });

  it("collectSkills continue branch when builtin name already seen (direct stub)", () => {
    const workspace = path.resolve("/workspace");
    const store = new SkillsStore(workspace, path.resolve("/builtin"));
    const wsRecord = {
      name: "dup",
      source: "workspace",
      path: "/a",
      description: "d",
      always: false,
      requires: null,
      available: true,
      missing: [],
    };
    const builtinRecord = { ...wsRecord, source: "builtin", path: "/b" };
    // stub scanDirectory to return workspace then builtin records
    (store as any).scanDirectory = vi
      .fn()
      .mockReturnValueOnce([wsRecord])
      .mockReturnValueOnce([builtinRecord]);

    const skills = (store as any).collectSkills();
    expect(skills.length).toBe(1);
  });

  it("parseMetadata returns empty object on invalid JSON", () => {
    const store = new SkillsStore(path.resolve("/workspace"));
    const parsed = (store as any).parseMetadata("not-json");
    expect(parsed).toEqual({});
  });

  it("evaluateRequirements returns available when bins and env are present", () => {
    const whichMock = vi.fn().mockReturnValue("/usr/bin/git");
    vi.stubGlobal("Bun", { which: whichMock });
    const previous = process.env.API_KEY;
    process.env.API_KEY = "ok";

    const store = new SkillsStore(path.resolve("/workspace"));
    const res = (store as any).evaluateRequirements({
      bins: ["git"],
      env: ["API_KEY"],
    });
    expect(res.available).toBe(true);
    expect(res.missing).toHaveLength(0);

    if (previous === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previous;
  });
});
