import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEARTBEAT_PROMPT,
  HeartbeatService,
} from "../../src/core/heartbeat.ts";

const { readFileMock, consolaInfoMock, consolaWarnMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  consolaInfoMock: vi.fn(),
  consolaWarnMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));
vi.mock("consola", () => ({
  consola: { info: consolaInfoMock, warn: consolaWarnMock },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

describe("heartbeatService", () => {
  it("does not trigger when file is empty or only checklists", async () => {
    readFileMock.mockResolvedValueOnce("# Title\n\n- [ ]\n");

    const onHeartbeat = vi.fn();
    const service = new HeartbeatService({
      workspace: "/workspace",
      onHeartbeat,
      intervalSeconds: 1,
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(onHeartbeat).not.toHaveBeenCalled();
    service.stop();
  });

  it("triggers when heartbeat has actionable content", async () => {
    readFileMock.mockResolvedValueOnce("Please check the queue.\n");

    const onHeartbeat = vi.fn().mockResolvedValue(undefined);
    const service = new HeartbeatService({
      workspace: "/workspace",
      onHeartbeat,
      intervalSeconds: 1,
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(onHeartbeat).toHaveBeenCalledWith(HEARTBEAT_PROMPT);
    expect(consolaInfoMock).toHaveBeenCalledWith(
      expect.stringContaining("Heartbeat service ready"),
    );
    service.stop();
  });

  it("logs warning when callback fails", async () => {
    readFileMock.mockResolvedValueOnce("Do something.\n");

    const onHeartbeat = vi.fn().mockRejectedValue(new Error("boom"));
    const service = new HeartbeatService({
      workspace: "/workspace",
      onHeartbeat,
      intervalSeconds: 1,
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(consolaWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Heartbeat execution failed"),
    );
    service.stop();
  });

  it("ignores missing heartbeat file", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"));

    const onHeartbeat = vi.fn();
    const service = new HeartbeatService({
      workspace: "/workspace",
      onHeartbeat,
      intervalSeconds: 1,
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(onHeartbeat).not.toHaveBeenCalled();
    service.stop();
  });

  it("does nothing when disabled", async () => {
    const onHeartbeat = vi.fn();
    const service = new HeartbeatService({
      workspace: "/workspace",
      onHeartbeat,
      enabled: false,
      intervalSeconds: 1,
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(consolaInfoMock).not.toHaveBeenCalled();
    expect(onHeartbeat).not.toHaveBeenCalled();
    service.stop();
  });

  it("times out when reading heartbeat file stalls", async () => {
    readFileMock.mockReturnValueOnce(new Promise(() => {}));

    const onHeartbeat = vi.fn();
    const service = new HeartbeatService({
      workspace: "/workspace",
      onHeartbeat,
    });
    await service.start();

    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();

    expect(onHeartbeat).not.toHaveBeenCalled();
    service.stop();
  });
});
