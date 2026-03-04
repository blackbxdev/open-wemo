import { getDatabase } from "../db";
import { fetchTimers } from "./rules";
import { soapRequest } from "./soap";
import { DAYS, TimerAction, type TimerRule } from "./types";

export interface FireEvent {
  ruleId: number;
  ruleName: string;
  action: 0 | 1;
}

const rulesCache = new Map<string, TimerRule[]>();
const firedToday = new Set<string>();
let lastCheckedSeconds = -1; // -1 = uninitialized; set to current time on first tick
let lastCheckedDayOfYear = -1;

function mapAction(action: TimerAction): 0 | 1 {
  return action === TimerAction.Off ? 0 : 1;
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// Maps JS getDay() (0=Sun..6=Sat) to DAYS bitmask via 2^n
function getDayBit(jsDay: number): number {
  return 1 << jsDay;
}

function matchesDay(dayId: number, currentDayBit: number): boolean {
  return dayId === DAYS.DAILY || dayId === DAYS.ALL || (dayId & currentDayBit) !== 0;
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function evaluateRuleInRange(rule: TimerRule, rangeStart: number, rangeEnd: number): FireEvent[] {
  const events: FireEvent[] = [];

  if (rangeStart < rule.startTime && rule.startTime <= rangeEnd) {
    events.push({
      ruleId: rule.ruleID,
      ruleName: rule.name,
      action: mapAction(rule.startAction),
    });
  }

  if (
    rule.endTime !== undefined &&
    rule.endAction !== undefined &&
    rangeStart < rule.endTime &&
    rule.endTime <= rangeEnd
  ) {
    events.push({
      ruleId: rule.ruleID,
      ruleName: rule.name,
      action: mapAction(rule.endAction),
    });
  }

  return events;
}

export function evaluateRules(
  rules: TimerRule[],
  nowSeconds: number,
  lastChecked: number,
  currentDayBit: number
): FireEvent[] {
  const events: FireEvent[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!matchesDay(rule.dayId, currentDayBit)) continue;

    if (nowSeconds < lastChecked) {
      // Midnight rollover: evaluate [lastChecked, 86400] then [-1, nowSeconds]
      events.push(...evaluateRuleInRange(rule, lastChecked, 86400));
      events.push(...evaluateRuleInRange(rule, -1, nowSeconds));
    } else {
      events.push(...evaluateRuleInRange(rule, lastChecked, nowSeconds));
    }
  }

  return events;
}

export async function tick(): Promise<void> {
  const now = new Date();
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const dayOfYear = getDayOfYear(now);
  const currentDayBit = getDayBit(now.getDay());

  if (dayOfYear !== lastCheckedDayOfYear) {
    firedToday.clear();
    lastCheckedDayOfYear = dayOfYear;
  }

  if (lastCheckedSeconds < 0) {
    lastCheckedSeconds = nowSeconds;
    console.log(
      `[Scheduler] Initialized at ${formatSeconds(nowSeconds)}, ${rulesCache.size} device(s) cached`
    );
    return;
  }

  for (const [deviceId, rules] of rulesCache) {
    const device = getDatabase().getDeviceById(deviceId);
    if (!device) continue;

    const enabledRules = rules.filter((r) => r.enabled);
    const events = evaluateRules(rules, nowSeconds, lastCheckedSeconds, currentDayBit);

    if (enabledRules.length > 0) {
      console.log(
        `[Scheduler] Tick ${formatSeconds(lastCheckedSeconds)}-${formatSeconds(nowSeconds)}: ${enabledRules.length} rule(s) for ${deviceId}, ${events.length} firing`
      );
    }

    for (const event of events) {
      const dedupKey = `${deviceId}:${event.ruleId}:${event.action}:${dayOfYear}`;
      if (firedToday.has(dedupKey)) {
        console.log(`[Scheduler] Skipping already-fired rule "${event.ruleName}" on ${deviceId}`);
        continue;
      }

      try {
        await soapRequest(
          device.host,
          device.port,
          "/upnp/control/basicevent1",
          "urn:Belkin:service:basicevent:1",
          "SetBinaryState",
          `<BinaryState>${event.action}</BinaryState>`
        );
        console.log(
          `[Scheduler] Fired rule "${event.ruleName}" (${event.action === 1 ? "ON" : "OFF"}) on device ${deviceId}`
        );
        firedToday.add(dedupKey);
      } catch (error) {
        console.error(
          `[Scheduler] Failed to fire rule "${event.ruleName}" on device ${deviceId}:`,
          error
        );
      }
    }
  }

  lastCheckedSeconds = nowSeconds;
}

export function startScheduler(): { stop: () => void } {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const runTick = () => {
    tick().catch((error) => {
      console.error("[Scheduler] Tick error:", error);
    });
  };

  // Align ticks to :00 and :30 second marks
  const now = new Date();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  const secondsUntilNext = seconds < 30 ? 30 - seconds : 60 - seconds;
  const delay = secondsUntilNext * 1000 - ms;

  // Run an initial tick immediately, then start the aligned interval
  runTick();

  const alignmentTimeout = setTimeout(() => {
    runTick();
    intervalId = setInterval(runTick, 30_000);
  }, delay);

  return {
    stop: () => {
      clearTimeout(alignmentTimeout);
      if (intervalId !== null) clearInterval(intervalId);
    },
  };
}

export async function loadDeviceRules(deviceId: string, host: string, port: number): Promise<void> {
  try {
    const result = await fetchTimers(host, port, deviceId);
    rulesCache.set(deviceId, result.rules);
  } catch (error) {
    console.error(`[Scheduler] Failed to load rules for device ${deviceId}:`, error);
  }
}

export function clearDeviceRules(deviceId: string): void {
  rulesCache.delete(deviceId);
  for (const key of [...firedToday]) {
    if (key.startsWith(`${deviceId}:`)) {
      firedToday.delete(key);
    }
  }
}

export function _resetForTesting(): void {
  rulesCache.clear();
  firedToday.clear();
  lastCheckedSeconds = -1;
  lastCheckedDayOfYear = -1;
}
