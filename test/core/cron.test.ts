import { beforeEach, describe, expect, it, vi } from "vitest";

import { CronService } from "../../src/core/cron.ts";

const {
  readFileMock,
  writeFileMock,
  mkdirMock,
  consolaInfoMock,
  consolaWarnMock,
} = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  mkdirMock: vi.fn().mockResolvedValue(undefined),
  consolaInfoMock: vi.fn(),
  consolaWarnMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  mkdir: mkdirMock,
}));
vi.mock("consola", () => ({
  consola: { info: consolaInfoMock, warn: consolaWarnMock },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cronService", () => {
  it("adds a job and computes next run for interval schedules", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "heartbeat",
      schedule: { kind: "every", everyMs: 5_000 },
      message: "ping",
    });

    expect(job.state.nextRunAtMs).toBe(6_000);
    expect(writeFileMock).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("executes a job and updates status", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    const handler = vi.fn().mockResolvedValue(undefined);
    const service = new CronService("memory/cron.json", handler);
    const job = await service.addJob({
      name: "run-once",
      schedule: { kind: "every", everyMs: 2_000 },
      message: "tick",
    });

    nowSpy.mockReturnValue(2_000);
    const ran = await service.runJob(job.id);

    expect(ran).toBe(true);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id }),
    );
    const jobs = await service.listJobs(true);
    expect(jobs[0]?.state.lastStatus).toBe("ok");
    expect(jobs[0]?.state.lastRunAtMs).toBe(2_000);

    nowSpy.mockRestore();
  });

  it("removes one-shot jobs marked deleteAfterRun", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "cleanup",
      schedule: { kind: "at", atMs: 5_000 },
      message: "cleanup",
      deleteAfterRun: true,
    });

    await service.runJob(job.id);

    const jobs = await service.listJobs(true);
    expect(jobs).toHaveLength(0);

    nowSpy.mockRestore();
  });

  it("warns on invalid cron expressions", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "bad-cron",
      schedule: { kind: "cron", expr: "invalid cron" },
      message: "oops",
    });

    expect(job.state.nextRunAtMs).toBeNull();
    expect(consolaWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Invalid cron expression"),
    );

    nowSpy.mockRestore();
  });

  it("starts and reports status with next wake", async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        jobs: [
          {
            id: "job-1",
            name: "ping",
            enabled: true,
            schedule: { kind: "every", everyMs: 1000 },
            payload: { message: "ping" },
            state: { nextRunAtMs: 2000 },
            createdAtMs: 1000,
            updatedAtMs: 1000,
          },
        ],
      }),
    );
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    const service = new CronService("memory/cron.json");
    await service.start();

    expect(consolaInfoMock).toHaveBeenCalledWith(
      expect.stringContaining("Cron service ready"),
    );
    expect(service.status().jobs).toBe(1);
    expect(service.status().nextWakeAtMs).toBe(2000);

    service.stop();
    nowSpy.mockRestore();
  });

  it("enables and disables jobs", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "toggle",
      schedule: { kind: "every", everyMs: 2_000 },
      message: "ping",
    });

    const disabled = await service.enableJob(job.id, false);
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.state.nextRunAtMs).toBeNull();

    const enabled = await service.enableJob(job.id, true);
    expect(enabled?.enabled).toBe(true);

    nowSpy.mockRestore();
  });

  it("returns false when removing or running missing jobs", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));

    const service = new CronService("memory/cron.json");
    expect(await service.removeJob("missing")).toBe(false);
    expect(await service.runJob("missing")).toBe(false);
  });

  it("records errors when handler throws", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const service = new CronService("memory/cron.json", handler);
    const job = await service.addJob({
      name: "fail",
      schedule: { kind: "every", everyMs: 1_000 },
      message: "ping",
    });

    await service.runJob(job.id);
    const jobs = await service.listJobs(true);
    expect(jobs[0]?.state.lastStatus).toBe("error");
    expect(jobs[0]?.state.lastError).toBe("boom");

    nowSpy.mockRestore();
  });

  it("computes next run for cron expressions including tz", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "cron-utc",
      schedule: { kind: "cron", expr: "* * * * *", tz: "UTC" },
      message: "tick",
    });

    expect(job.state.nextRunAtMs).not.toBeNull();

    nowSpy.mockRestore();
  });

  it("onTimer processes due jobs and saves store", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const handler = vi.fn().mockResolvedValue(undefined);
    const service = new CronService("memory/cron.json", handler);
    await service.addJob({
      name: "due",
      schedule: { kind: "every", everyMs: 1_000 },
      message: "now",
    });

    // make job due by setting its nextRunAtMs in the past
    // @ts-expect-error access private for testing
    service.store!.jobs[0].state.nextRunAtMs = 1_000;
    // simulate running so onTimer proceeds to execute job
    // @ts-expect-error access private for testing
    service.running = true;

    await (service as any).onTimer();

    expect(handler).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("saveStore does nothing when store is null and ensureDir rejection is swallowed", async () => {
    // when store is null, saveStore should return without calling writeFile
    const service = new CronService("memory/cron.json");
    await (service as any).saveStore();
    expect(writeFileMock).not.toHaveBeenCalled();

    // now set a store and make mkdir reject — ensureDir swallows the error
    (service as any).store = { version: 1, jobs: [] };
    mkdirMock.mockRejectedValueOnce(new Error("nope"));
    await (service as any).saveStore();
    expect(writeFileMock).toHaveBeenCalled();
  });

  it("status reports disabled and empty when not started", () => {
    const service = new CronService("memory/cron.json");
    const s = service.status();
    expect(s.enabled).toBe(false);
    expect(s.jobs).toBe(0);
    expect(s.nextWakeAtMs).toBeNull();
  });

  it("onTimer returns early when store is missing or not running", async () => {
    const service = new CronService("memory/cron.json");
    // no store set
    await (service as any).onTimer();

    // set store but not running
    (service as any).store = { version: 1, jobs: [] };
    (service as any).running = false;
    await (service as any).onTimer();
    // nothing should have been written
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("executes 'at' job and disables it when deleteAfterRun is false", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const handler = vi.fn().mockResolvedValue(undefined);
    const service = new CronService("memory/cron.json", handler);
    const job = await service.addJob({
      name: "once",
      schedule: { kind: "at", atMs: 2_000 },
      message: "run",
      deleteAfterRun: false,
    });

    // run it directly
    await service.runJob(job.id);

    const stored = (service as any).store.jobs.find(
      (j: any) => j.id === job.id,
    );
    expect(stored.enabled).toBe(false);
    expect(stored.state.nextRunAtMs).toBeNull();

    nowSpy.mockRestore();
  });

  it("loadStore maps partial job fields with defaults", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5_000);
    const raw = {
      version: 2,
      jobs: [
        {
          id: "j1",
          name: "p",
          // minimal schedule
          schedule: { kind: "every" },
          payload: { message: "m" },
          state: {},
        },
      ],
    };
    readFileMock.mockResolvedValueOnce(JSON.stringify(raw));

    const service = new CronService("memory/cron.json");
    const jobs = await service.listJobs(true);
    expect(jobs.length).toBe(1);
    const j = jobs[0];
    expect(j.payload.kind).toBe("agent_turn");
    expect(j.schedule.everyMs).toBeNull();
    expect(j.createdAtMs).toBeGreaterThanOrEqual(5_000);

    nowSpy.mockRestore();
  });

  it("armTimer clears an existing timer when re-arming", () => {
    const service = new CronService("memory/cron.json");
    // simulate running and existing timer
    (service as any).running = true;
    (service as any).timer = setTimeout(() => {}, 10000);
    // store with no jobs so getNextWakeMs returns null
    (service as any).store = { version: 1, jobs: [] };

    (service as any).armTimer();
    expect((service as any).timer).toBeNull();
  });

  it("addJob with non-positive everyMs yields null nextRunAtMs", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const service = new CronService("memory/cron.json");
    const jobZero = await service.addJob({
      name: "zero",
      schedule: { kind: "every", everyMs: 0 },
      message: "none",
    });
    expect(jobZero.state.nextRunAtMs).toBeNull();

    const jobNeg = await service.addJob({
      name: "neg",
      schedule: { kind: "every", everyMs: -100 },
      message: "none",
    });
    expect(jobNeg.state.nextRunAtMs).toBeNull();

    nowSpy.mockRestore();
  });

  it("addJob with 'at' in the past yields null nextRunAtMs", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "past",
      schedule: { kind: "at", atMs: 1_000 },
      message: "past",
    });
    expect(job.state.nextRunAtMs).toBeNull();

    nowSpy.mockRestore();
  });

  it("addJob with cron expr without tz computes nextRunAtMs", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "cron-no-tz",
      schedule: { kind: "cron", expr: "* * * * *" },
      message: "tick",
    });
    expect(job.state.nextRunAtMs).not.toBeNull();

    nowSpy.mockRestore();
  });

  it("loadStore handles malformed job structure by returning empty store", async () => {
    // job missing schedule will cause mapping to throw and be caught
    const raw = { version: 1, jobs: [{ id: "x", name: "bad" }] };
    readFileMock.mockResolvedValueOnce(JSON.stringify(raw));

    const service = new CronService("memory/cron.json");
    const jobs = await service.listJobs(true);
    expect(jobs).toHaveLength(0);
  });

  it("addJob with cron expr null yields null nextRunAtMs", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);

    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "cron-null",
      // expr explicitly null
      schedule: { kind: "cron", expr: null as any },
      message: "no",
    });
    expect(job.state.nextRunAtMs).toBeNull();

    nowSpy.mockRestore();
  });

  it("start returns early when already running", async () => {
    const service = new CronService("memory/cron.json");
    (service as any).running = true;
    // stub loadStore to detect calls
    (service as any).loadStore = vi.fn();
    await service.start();
    expect((service as any).loadStore).not.toHaveBeenCalled();
  });

  it("onTimer with no due jobs still saves store and re-arms", async () => {
    const service = new CronService("memory/cron.json");
    (service as any).store = {
      version: 1,
      jobs: [
        {
          id: "a",
          name: "future",
          enabled: true,
          schedule: { kind: "every", everyMs: 1000 },
          payload: { message: "x" },
          state: { nextRunAtMs: Date.now() + 100000 },
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        } as any,
      ],
    };
    (service as any).running = true;

    await (service as any).onTimer();
    // should still call saveStore
    expect(writeFileMock).toHaveBeenCalled();
  });

  it("loadStore maps provided state fields correctly", async () => {
    const raw = {
      version: 1,
      jobs: [
        {
          id: "s1",
          name: "stated",
          enabled: false,
          schedule: { kind: "every" },
          payload: {
            kind: "system_event",
            message: "m",
            deliver: true,
            channel: "c",
            to: "t",
          },
          state: {
            nextRunAtMs: 123,
            lastRunAtMs: 122,
            lastStatus: "ok",
            lastError: "err",
          },
          createdAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    };
    readFileMock.mockResolvedValueOnce(JSON.stringify(raw));

    const service = new CronService("memory/cron.json");
    const jobs = await service.listJobs(true);
    expect(jobs[0].state.nextRunAtMs).toBe(123);
    expect(jobs[0].payload.kind).toBe("system_event");
  });

  it("listJobs sorts multiple jobs by nextRunAtMs (comparator executed)", async () => {
    const now = Date.now();
    const raw = {
      version: 1,
      jobs: [
        {
          id: "j1",
          name: "a",
          enabled: true,
          schedule: { kind: "every" },
          payload: { message: "x" },
          state: { nextRunAtMs: now + 2000 },
          createdAtMs: now,
          updatedAtMs: now,
        },
        {
          id: "j2",
          name: "b",
          enabled: true,
          schedule: { kind: "every" },
          payload: { message: "y" },
          state: { nextRunAtMs: now + 1000 },
          createdAtMs: now,
          updatedAtMs: now,
        },
      ],
    };
    readFileMock.mockResolvedValueOnce(JSON.stringify(raw));

    const service = new CronService("memory/cron.json");
    const jobs = await service.listJobs();
    expect(jobs[0].id).toBe("j2");
    expect(jobs[1].id).toBe("j1");
  });

  it("enableJob returns null when job not found", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const service = new CronService("memory/cron.json");
    const res = await service.enableJob("nope", true);
    expect(res).toBeNull();
  });

  it("armTimer sets a timer when nextWake exists", () => {
    const service = new CronService("memory/cron.json");
    (service as any).running = true;
    const now = Date.now();
    (service as any).store = {
      version: 1,
      jobs: [
        {
          id: "t1",
          name: "t",
          enabled: true,
          schedule: { kind: "every" },
          payload: { message: "m" },
          state: { nextRunAtMs: now + 100 },
          createdAtMs: now,
          updatedAtMs: now,
        },
      ],
    } as any;

    (service as any).armTimer();
    expect((service as any).timer).not.toBeNull();
    if ((service as any).timer) {
      clearTimeout((service as any).timer);
      (service as any).timer = null;
    }
  });

  it("removeJob saves store and re-arms when a job is removed", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));
    const service = new CronService("memory/cron.json");
    const job = await service.addJob({
      name: "rm",
      schedule: { kind: "every", everyMs: 1000 },
      message: "x",
    });
    const removed = await service.removeJob(job.id);
    expect(removed).toBe(true);
    expect(writeFileMock).toHaveBeenCalled();
  });

  it("armTimer schedules callback and invokes onTimer (setTimeout path)", () => {
    const service = new CronService("memory/cron.json");
    (service as any).running = true;
    const now = Date.now();
    (service as any).store = {
      version: 1,
      jobs: [
        {
          id: "t2",
          name: "t",
          enabled: true,
          schedule: { kind: "every" },
          payload: { message: "m" },
          state: { nextRunAtMs: now + 100 },
          createdAtMs: now,
          updatedAtMs: now,
        },
      ],
    } as any;

    const origSet = globalThis.setTimeout;
    try {
      (service as any).onTimer = vi.fn();
      // run callback immediately
      globalThis.setTimeout = ((cb: (...args: any[]) => void) => {
        cb();
        return 1 as any;
      }) as any;
      (service as any).armTimer();
      expect((service as any).onTimer).toHaveBeenCalled();
    } finally {
      globalThis.setTimeout = origSet as any;
    }
  });
});
