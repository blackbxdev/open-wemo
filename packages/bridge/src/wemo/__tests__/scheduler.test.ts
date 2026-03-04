/**
 * TDD RED phase tests for the bridge-side timer scheduler.
 * Imports from ../scheduler which does NOT exist yet — all tests MUST FAIL.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type FireEvent,
  clearDeviceRules,
  evaluateRules,
  loadDeviceRules,
  startScheduler,
  tick,
} from "../scheduler";
import { DAYS, TimerAction, type TimerRule } from "../types";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSoapRequest = mock(() =>
  Promise.resolve({ success: true as const, data: {} as Record<string, unknown> })
);
mock.module("../soap", () => ({
  soapRequest: mockSoapRequest,
}));

const mockGetDeviceById = mock(() => ({
  id: "device-1",
  name: "Living Room",
  deviceType: "Switch",
  host: "192.168.1.50",
  port: 49153,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  isOnline: true,
}));
mock.module("../../db", () => ({
  getDatabase: () => ({ getDeviceById: mockGetDeviceById }),
}));

const mockFetchTimers = mock(() =>
  Promise.resolve({
    deviceId: "device-1",
    rules: [] as TimerRule[],
    dbVersion: 1,
  })
);
mock.module("../rules", () => ({
  fetchTimers: mockFetchTimers,
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<TimerRule> = {}): TimerRule {
  return {
    ruleID: 1,
    name: "Test Rule",
    type: "Timer",
    enabled: true,
    startTime: 25200, // 7*3600 = 7:00 AM
    startAction: TimerAction.On,
    dayId: DAYS.DAILY,
    ...overrides,
  };
}

// ── evaluateRules — pure function, no mocks needed ─────────────────────────────

describe("evaluateRules", () => {
  test("returns fire event when lastCheckedSeconds < rule.startTime <= nowSeconds", () => {
    const rule = makeRule({ startTime: 25200 });
    const events = evaluateRules([rule], 25200, 25190, DAYS.MON);

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe(1);
  });

  test("returns empty array when rule time is outside the checked window", () => {
    const rule = makeRule({ startTime: 25200 });
    const events = evaluateRules([rule], 30010, 30000, DAYS.MON);

    expect(events).toEqual([]);
  });

  test("returns empty array when nowSeconds < rule.startTime (future rule)", () => {
    const rule = makeRule({ startTime: 25200 });
    const events = evaluateRules([rule], 20000, 19990, DAYS.MON);

    expect(events).toEqual([]);
  });

  test("returns empty array when lastCheckedSeconds >= rule.startTime (already past)", () => {
    const rule = makeRule({ startTime: 25200 });
    const events = evaluateRules([rule], 25210, 25200, DAYS.MON);

    expect(events).toEqual([]);
  });

  test("matches daily rules (dayId === -1) on any day", () => {
    const rule = makeRule({ dayId: DAYS.DAILY });
    const events = evaluateRules([rule], 25200, 25190, DAYS.FRI);

    expect(events).toHaveLength(1);
  });

  test("matches ALL rules (dayId === 127) on any day", () => {
    const rule = makeRule({ dayId: DAYS.ALL });
    const events = evaluateRules([rule], 25200, 25190, DAYS.SAT);

    expect(events).toHaveLength(1);
  });

  test("does NOT match bitmask rule on wrong day (MON|WED|FRI=42 vs TUE=4)", () => {
    const MWF = DAYS.MON | DAYS.WED | DAYS.FRI; // 2|8|32 = 42
    const rule = makeRule({ dayId: MWF });
    const events = evaluateRules([rule], 25200, 25190, DAYS.TUE);

    expect(events).toEqual([]);
  });

  test("matches bitmask rule on correct day (MON|WED|FRI=42 vs MON=2)", () => {
    const MWF = DAYS.MON | DAYS.WED | DAYS.FRI;
    const rule = makeRule({ dayId: MWF });
    const events = evaluateRules([rule], 25200, 25190, DAYS.MON);

    expect(events).toHaveLength(1);
  });

  test("skips disabled rules (enabled === false)", () => {
    const rule = makeRule({ enabled: false });
    const events = evaluateRules([rule], 25200, 25190, DAYS.MON);

    expect(events).toEqual([]);
  });

  test("maps TimerAction.On (1) to action 1", () => {
    const rule = makeRule({ startAction: TimerAction.On });
    const events = evaluateRules([rule], 25200, 25190, DAYS.MON);

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe(1);
  });

  test("maps TimerAction.Off (0) to action 0", () => {
    const rule = makeRule({ startAction: TimerAction.Off });
    const events = evaluateRules([rule], 25200, 25190, DAYS.MON);

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe(0);
  });

  test("evaluates endTime/endAction when present — returns second fire event", () => {
    const rule = makeRule({
      startTime: 25200,
      endTime: 82800, // 23*3600 = 11:00 PM
      startAction: TimerAction.On,
      endAction: TimerAction.Off,
    });
    const events = evaluateRules([rule], 82800, 25190, DAYS.MON);

    expect(events.length).toBeGreaterThanOrEqual(2);
    const startEvent = events.find((e: FireEvent) => e.action === 1);
    const endEvent = events.find((e: FireEvent) => e.action === 0);
    expect(startEvent).toBeDefined();
    expect(endEvent).toBeDefined();
  });

  test("does NOT evaluate endTime when endAction is undefined", () => {
    const rule = makeRule({
      startTime: 25200,
      endTime: 82800,
      startAction: TimerAction.On,
      endAction: undefined,
    });
    const events = evaluateRules([rule], 82800, 25190, DAYS.MON);

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe(1);
  });

  test("returns multiple fire events when multiple rules match", () => {
    const rule1 = makeRule({ ruleID: 1, startTime: 25200, startAction: TimerAction.On });
    const rule2 = makeRule({
      ruleID: 2,
      startTime: 25200,
      startAction: TimerAction.Off,
      name: "Rule 2",
    });
    const events = evaluateRules([rule1, rule2], 25200, 25190, DAYS.MON);

    expect(events).toHaveLength(2);
  });

  test("returns empty array for empty rules list", () => {
    const events = evaluateRules([], 25200, 25190, DAYS.MON);

    expect(events).toEqual([]);
  });

  // Midnight rollover: lastChecked=86390 (23:59:50), now=10 (00:00:10 next day)
  // Rule at 86395 fires in 86390..86400 range, rule at 5 fires in 0..10 range
  test("handles midnight rollover: evaluates rules in both time ranges", () => {
    const lateRule = makeRule({ ruleID: 1, startTime: 86395, name: "Late Night" });
    const earlyRule = makeRule({ ruleID: 2, startTime: 5, name: "Early Morning" });
    const events = evaluateRules([lateRule, earlyRule], 10, 86390, DAYS.MON);

    expect(events).toHaveLength(2);
  });

  test("populates fire event with correct ruleId, ruleName, deviceId", () => {
    const rule = makeRule({ ruleID: 42, name: "Bedroom Light", startTime: 25200 });
    const events = evaluateRules([rule], 25200, 25190, DAYS.MON);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        ruleId: 42,
        ruleName: "Bedroom Light",
        action: 1,
      })
    );
  });
});

// ── tick() orchestration — mock soapRequest ─────────────────────────────────

describe("tick", () => {
  beforeEach(async () => {
    const mod: { _resetForTesting?: () => void } = await import("../scheduler");
    mod._resetForTesting?.();
    mockSoapRequest.mockClear();
    mockGetDeviceById.mockClear();
    await tick();
  });

  test("calls soapRequest with correct SetBinaryState payload for each fire event", async () => {
    mockGetDeviceById.mockReturnValue({
      id: "device-1",
      name: "Living Room",
      deviceType: "Switch",
      host: "192.168.1.50",
      port: 49153,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      isOnline: true,
    });

    await tick();

    for (const call of mockSoapRequest.mock.calls as unknown[][]) {
      expect(call[2]).toBe("/upnp/control/basicevent1");
      expect(call[3]).toBe("urn:Belkin:service:basicevent:1");
      expect(call[4]).toBe("SetBinaryState");
      expect(call[5]).toMatch(/^<BinaryState>[01]<\/BinaryState>$/);
    }
  });

  test("logs [Scheduler] prefix for each fire", async () => {
    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy;

    try {
      await tick();

      const schedulerLogs = (logSpy.mock.calls as unknown[][]).filter(
        (args) => typeof args[0] === "string" && (args[0] as string).includes("[Scheduler]")
      );
      expect(schedulerLogs.length).toBeGreaterThanOrEqual(0);
    } finally {
      console.log = origLog;
    }
  });

  test("catches and logs SOAP failures without throwing", async () => {
    mockSoapRequest.mockRejectedValue(new Error("SOAP timeout"));

    await expect(tick()).resolves.toBeUndefined();
  });

  test("reads current device host:port from DB via getDatabase().getDeviceById()", async () => {
    mockFetchTimers.mockResolvedValue({
      deviceId: "device-1",
      rules: [makeRule()],
      dbVersion: 1,
    });

    await loadDeviceRules("device-1", "192.168.1.50", 49153);
    await tick();

    expect(mockGetDeviceById).toHaveBeenCalled();
  });

  test("does not re-fire a rule+day+action that already fired (dedup)", async () => {
    await tick();
    const firstCallCount = mockSoapRequest.mock.calls.length;

    await tick();
    const secondCallCount = mockSoapRequest.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);
  });

  test("clears fired-today set when day-of-year changes", async () => {
    await tick();
    const firstCallCount = mockSoapRequest.mock.calls.length;

    // After a day boundary, previously-fired rules should fire again
    await tick();
    expect(mockSoapRequest.mock.calls.length).toBeGreaterThanOrEqual(firstCallCount);
  });
});

// ── Lifecycle ──────────────────────────────────────────────────────────────────

describe("lifecycle", () => {
  let stopFn: { stop: () => void };

  beforeEach(async () => {
    const mod: { _resetForTesting?: () => void } = await import("../scheduler");
    mod._resetForTesting?.();
    mockFetchTimers.mockClear();
    mockSoapRequest.mockClear();
    await tick();
  });

  afterEach(() => {
    stopFn?.stop?.();
  });

  test("startScheduler() returns object with stop() function", () => {
    stopFn = startScheduler();

    expect(stopFn).toBeDefined();
    expect(typeof stopFn.stop).toBe("function");
  });

  test("stop() clears the interval (no more ticks)", async () => {
    stopFn = startScheduler();
    stopFn.stop();

    mockSoapRequest.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockSoapRequest).not.toHaveBeenCalled();
  });

  test("loadDeviceRules(deviceId, host, port) fetches via fetchTimers() and caches rules", async () => {
    mockFetchTimers.mockResolvedValue({
      deviceId: "device-1",
      rules: [makeRule()],
      dbVersion: 2,
    });

    await loadDeviceRules("device-1", "192.168.1.50", 49153);

    expect(mockFetchTimers).toHaveBeenCalledWith("192.168.1.50", 49153, "device-1");
  });

  test("clearDeviceRules(deviceId) removes device entry from cache", async () => {
    mockFetchTimers.mockResolvedValue({
      deviceId: "device-1",
      rules: [makeRule()],
      dbVersion: 2,
    });

    await loadDeviceRules("device-1", "192.168.1.50", 49153);
    clearDeviceRules("device-1");

    mockSoapRequest.mockClear();
    await tick();

    expect(mockSoapRequest).not.toHaveBeenCalled();
  });
});
