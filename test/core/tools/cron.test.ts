import { describe, expect, it, vi } from "vitest";

import { CronTool } from "../../../src/core/tools/cron.ts";

describe("cronTool", () => {
  it("adds a job with everySeconds schedule", async () => {
    const addJob = vi.fn().mockResolvedValue({
      id: "job1",
      name: "job name",
      enabled: true,
      schedule: { kind: "every", everyMs: 2000 },
      payload: { message: "hello" },
      state: { nextRunAtMs: 1234 },
    });
    const cron = { addJob, listJobs: vi.fn(), removeJob: vi.fn() };
    const tool = new CronTool(cron as any);
    tool.setContext("cli", "direct");

    const result = await tool.execute({
      action: "add",
      message: "hello",
      everySeconds: 2,
    });

    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "hello",
        deliver: true,
        channel: "cli",
        to: "direct",
      }),
    );
    expect(result).toContain("Scheduled job");
  });

  it("lists jobs and reports empty state", async () => {
    const cron = {
      addJob: vi.fn(),
      listJobs: vi.fn().mockResolvedValue([]),
      removeJob: vi.fn(),
    };
    const tool = new CronTool(cron as any);

    const empty = await tool.execute({ action: "list" });
    expect(empty).toBe("No active jobs.");
    expect(cron.listJobs).toHaveBeenCalledWith(false);
  });

  it("lists active jobs and formats entries", async () => {
    const cron = {
      addJob: vi.fn(),
      listJobs: vi.fn().mockResolvedValue([
        {
          id: "job1",
          name: "daily",
          enabled: true,
          schedule: { kind: "cron" },
          state: { nextRunAtMs: null },
        },
      ]),
      removeJob: vi.fn(),
    };
    const tool = new CronTool(cron as any);

    const result = await tool.execute({ action: "list" });

    expect(result).toContain("daily");
    expect(result).toContain("enabled");
    expect(result).toContain("next: (unscheduled)");
  });

  it("removes jobs by id", async () => {
    const cron = {
      addJob: vi.fn(),
      listJobs: vi.fn(),
      removeJob: vi.fn().mockResolvedValue(true),
    };
    const tool = new CronTool(cron as any);

    const result = await tool.execute({ action: "remove", jobId: "abc" });
    expect(result).toBe("Removed job abc");
  });

  it("rejects remove without jobId", async () => {
    const cron = { addJob: vi.fn(), listJobs: vi.fn(), removeJob: vi.fn() };
    const tool = new CronTool(cron as any);

    await expect(tool.execute({ action: "remove" })).rejects.toThrow(
      "jobId is required",
    );
  });

  it("validates missing message or schedule", async () => {
    const cron = { addJob: vi.fn(), listJobs: vi.fn(), removeJob: vi.fn() };
    const tool = new CronTool(cron as any);
    tool.setContext("cli", "direct");

    await expect(tool.execute({ action: "add" })).rejects.toThrow(
      "message is required",
    );
    await expect(
      tool.execute({ action: "add", message: "hi" }),
    ).rejects.toThrow("Provide either");
  });

  it("adds an at-scheduled job and defaults deleteAfterRun", async () => {
    const addJob = vi.fn().mockResolvedValue({
      id: "job2",
      name: "once",
      enabled: true,
      schedule: { kind: "at" },
      state: { nextRunAtMs: 0 },
    });
    const cron = { addJob, listJobs: vi.fn(), removeJob: vi.fn() };
    const tool = new CronTool(cron as any);
    tool.setContext("cli", "direct");

    const result = await tool.execute({
      action: "add",
      message: "once",
      at: new Date(0).toISOString(),
    });

    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        deleteAfterRun: true,
      }),
    );
    expect(result).toContain("Scheduled job");
  });

  it("rejects invalid at timestamps and unsupported actions", async () => {
    const cron = { addJob: vi.fn(), listJobs: vi.fn(), removeJob: vi.fn() };
    const tool = new CronTool(cron as any);

    await expect(
      tool.execute({ action: "add", message: "hi", at: "not-a-date" }),
    ).rejects.toThrow("Invalid ISO timestamp");
    await expect(tool.execute({ action: "noop" as any })).rejects.toThrow(
      "Unsupported action",
    );
  });

  it("validates argument types", () => {
    const tool = new CronTool({
      addJob: vi.fn(),
      listJobs: vi.fn(),
      removeJob: vi.fn(),
    } as any);
    const errors = tool.validate({
      action: "unknown",
      everySeconds: "x" as any,
      cronExpr: 1 as any,
      at: 2 as any,
      message: false as any,
      jobId: [] as any,
    });

    expect(errors).toContain(
      'Value at \'action\' must be one of ["add","list","remove"]',
    );
    expect(errors).toContain("Value at 'everySeconds' should be number");
    expect(errors).toContain("Value at 'cronExpr' should be string");
    expect(errors).toContain("Value at 'at' should be string");
    expect(errors).toContain("Value at 'message' should be string");
    expect(errors).toContain("Value at 'jobId' should be string");
  });

  it("rejects add when channel context is missing", async () => {
    const cron = { addJob: vi.fn(), listJobs: vi.fn(), removeJob: vi.fn() };
    const tool = new CronTool(cron as any);
    (tool as any).defaultChannel = "";
    (tool as any).defaultChatId = "";

    await expect(
      tool.execute({ action: "add", message: "hi", everySeconds: 5 }),
    ).rejects.toThrow("Cannot add job without a channel/chat context");
  });
});
