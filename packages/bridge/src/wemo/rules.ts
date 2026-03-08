/**
 * WeMo Timer Rules Support
 *
 * Provides fetch/store helpers for WeMo rules DB, SQLite CRUD operations,
 * and convenience functions for timer schedule management.
 */

import { Database } from "bun:sqlite";
import { unzipSync, zipSync } from "fflate";
import { extractTextValue, soapRequest } from "./soap";
import { syncDeviceTime } from "./timesync";
import {
  type CreateTimerInput,
  DAYS,
  type DeviceRule,
  TimerAction,
  type TimerRule,
  type TimerSchedule,
  type UpdateTimerInput,
} from "./types";

/**
 * Service type for rules operations.
 */
const RULES_SERVICE = "urn:Belkin:service:rules:1";

/**
 * Control URL for rules SOAP actions.
 */
const RULES_CONTROL_URL = "/upnp/control/rules1";

/**
 * SQLite filename expected inside the rules ZIP payload.
 */
const RULES_DB_FILENAME = "temppluginRules.db";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_BITS = [DAYS.SUN, DAYS.MON, DAYS.TUE, DAYS.WED, DAYS.THU, DAYS.FRI, DAYS.SAT] as const;

function toTimerAction(value: number): TimerAction {
  if (value <= 0) return TimerAction.Off;
  if (value >= 2) return TimerAction.On;
  return TimerAction.On;
}

function openDatabaseFromBuffer(dbBuffer: Uint8Array): Database {
  return Database.deserialize(dbBuffer);
}

function toRuleDbUrl(host: string, port: number, ruleDbPath: string): string {
  return new URL(ruleDbPath, `http://${host}:${port}`).toString();
}

/**
 * Creates an empty rules SQLite database with WeMo timer schema.
 *
 * @returns Serialized SQLite database bytes
 */
export function createEmptyRulesDb(): Uint8Array {
  const db = new Database(":memory:");

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS RULES (
        RuleID INTEGER PRIMARY KEY,
        Name TEXT NOT NULL,
        Type TEXT NOT NULL,
        RuleOrder INTEGER,
        StartDate TEXT,
        EndDate TEXT,
        State TEXT,
        Sync INTEGER
      );

      CREATE TABLE IF NOT EXISTS RULEDEVICES (
        RuleDevicePK INTEGER PRIMARY KEY AUTOINCREMENT,
        RuleID INTEGER,
        DeviceID TEXT,
        GroupID INTEGER,
        DayID INTEGER,
        StartTime INTEGER,
        RuleDuration INTEGER,
        StartAction REAL,
        EndAction REAL,
        SensorDuration INTEGER,
        Type INTEGER,
        Value INTEGER,
        Level INTEGER,
        ZBCapabilityStart TEXT,
        ZBCapabilityEnd TEXT,
        OnModeOffset INTEGER,
        OffModeOffset INTEGER,
        CountdownTime INTEGER,
        EndTime INTEGER
      );

      CREATE TABLE IF NOT EXISTS TARGETDEVICES (
        TargetDevicesPK INTEGER PRIMARY KEY AUTOINCREMENT,
        RuleID INTEGER,
        DeviceID TEXT,
        DeviceIndex INTEGER
      );
    `);

    return db.serialize();
  } finally {
    db.close();
  }
}

/**
 * Parses timer rules from a serialized WeMo rules database.
 *
 * @param dbBuffer - Serialized SQLite DB bytes
 * @returns Parsed timer rules (non-Timer rules are filtered out)
 */
export function parseRulesFromDb(dbBuffer: Uint8Array): TimerRule[] {
  const db = openDatabaseFromBuffer(dbBuffer);

  try {
    const query = db.query<
      {
        ruleID: number;
        name: string;
        ruleType: string;
        state: string;
        dayId: number;
        startTime: number;
        endTime: number;
        startAction: number;
        endAction: number;
      },
      []
    >(`
      SELECT
        RULES.RuleID AS ruleID,
        RULES.Name AS name,
        RULES.Type AS ruleType,
        RULES.State AS state,
        RULEDEVICES.DayID AS dayId,
        RULEDEVICES.StartTime AS startTime,
        RULEDEVICES.EndTime AS endTime,
        RULEDEVICES.StartAction AS startAction,
        RULEDEVICES.EndAction AS endAction
      FROM RULES
      INNER JOIN RULEDEVICES ON RULES.RuleID = RULEDEVICES.RuleID
      ORDER BY RULES.RuleID ASC
    `);

    const rows = query.all();

    return rows
      .filter((row) => row.ruleType === "Timer")
      .map((row) => {
        const parsedEndTime = Number(row.endTime);
        const parsedStartTime = Number(row.startTime);
        const parsedEndAction = Number(row.endAction);

        return {
          ruleID: Number(row.ruleID),
          name: row.name,
          type: "Timer",
          enabled: String(row.state) === "1",
          startTime: parsedStartTime,
          endTime:
            parsedEndTime > 0 && parsedEndTime !== parsedStartTime ? parsedEndTime : undefined,
          startAction: toTimerAction(Number(row.startAction)),
          endAction: parsedEndAction >= 0 ? toTimerAction(parsedEndAction) : undefined,
          dayId: Number(row.dayId),
        } satisfies TimerRule;
      });
  } finally {
    db.close();
  }
}

export function parseAllRulesFromDb(dbBuffer: Uint8Array): DeviceRule[] {
  const db = openDatabaseFromBuffer(dbBuffer);

  try {
    const query = db.query<
      {
        ruleID: number;
        name: string;
        ruleType: string;
        state: string;
        dayId: number;
        startTime: number;
        endTime: number;
        startAction: number;
        endAction: number;
        ruleDuration: number;
        sensorDuration: number;
        countdownTime: number;
      },
      []
    >(`
      SELECT
        RULES.RuleID AS ruleID,
        RULES.Name AS name,
        RULES.Type AS ruleType,
        RULES.State AS state,
        RULEDEVICES.DayID AS dayId,
        RULEDEVICES.StartTime AS startTime,
        RULEDEVICES.EndTime AS endTime,
        RULEDEVICES.StartAction AS startAction,
        RULEDEVICES.EndAction AS endAction,
        RULEDEVICES.RuleDuration AS ruleDuration,
        RULEDEVICES.SensorDuration AS sensorDuration,
        RULEDEVICES.CountdownTime AS countdownTime
      FROM RULES
      INNER JOIN RULEDEVICES ON RULES.RuleID = RULEDEVICES.RuleID
      ORDER BY RULES.RuleID ASC
    `);

    return query.all().map((row) => ({
      ruleID: Number(row.ruleID),
      name: row.name,
      type: row.ruleType,
      enabled: String(row.state) === "1",
      dayId: Number(row.dayId),
      startTime: Number(row.startTime),
      endTime: Number(row.endTime),
      ruleDuration: Number(row.ruleDuration),
      startAction: Number(row.startAction),
      endAction: Number(row.endAction),
      sensorDuration: Number(row.sensorDuration),
      countdownTime: Number(row.countdownTime),
    }));
  } finally {
    db.close();
  }
}

/**
 * Adds a timer rule to a serialized WeMo rules database.
 *
 * @param dbBuffer - Serialized SQLite DB bytes
 * @param rule - New timer rule data
 * @param deviceUdn - Device UDN to associate with rule rows
 * @returns Updated serialized SQLite DB bytes
 */
export function addRuleToDb(
  dbBuffer: Uint8Array,
  rule: CreateTimerInput,
  deviceUdn: string
): Uint8Array {
  const db = openDatabaseFromBuffer(dbBuffer);

  try {
    const nextRuleIdRow = db
      .query<{ nextRuleId: number }, []>(
        "SELECT COALESCE(MAX(RuleID), 0) + 1 AS nextRuleId FROM RULES"
      )
      .get();
    const nextRuleId = Number(nextRuleIdRow?.nextRuleId ?? 1);

    db.query(
      "INSERT INTO RULES (RuleID, Name, Type, RuleOrder, StartDate, EndDate, State, Sync) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    ).run(nextRuleId, rule.name, "Timer", 0, "12201982", "07301982", "1", "NOSYNC");

    const endTime = rule.endTime;
    const hasEndTime = endTime !== undefined && endTime > 0;
    const effectiveEndTime = hasEndTime ? endTime : 86400;
    const ruleDuration = hasEndTime
      ? (endTime - rule.startTime + 86400) % 86400
      : 86400 - rule.startTime;

    db.query(
      "INSERT INTO RULEDEVICES (RuleID, DeviceID, GroupID, DayID, StartTime, RuleDuration, StartAction, EndAction, SensorDuration, Type, Value, Level, ZBCapabilityStart, ZBCapabilityEnd, OnModeOffset, OffModeOffset, CountdownTime, EndTime) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"
    ).run(
      nextRuleId,
      deviceUdn,
      0,
      rule.dayId,
      rule.startTime,
      ruleDuration,
      Number(rule.startAction),
      rule.endAction !== undefined ? Number(rule.endAction) : -1,
      -1,
      -1,
      -1,
      -1,
      "",
      "",
      -1,
      -1,
      -1,
      effectiveEndTime
    );

    db.query("INSERT INTO TARGETDEVICES (RuleID, DeviceID, DeviceIndex) VALUES (?1, ?2, ?3)").run(
      nextRuleId,
      deviceUdn,
      0
    );

    return db.serialize();
  } finally {
    db.close();
  }
}

/**
 * Updates a timer rule in a serialized WeMo rules database.
 *
 * @param dbBuffer - Serialized SQLite DB bytes
 * @param ruleId - RuleID to update
 * @param changes - Partial timer updates
 * @returns Updated serialized SQLite DB bytes
 */
export function updateRuleInDb(
  dbBuffer: Uint8Array,
  ruleId: number,
  changes: UpdateTimerInput
): Uint8Array {
  const db = openDatabaseFromBuffer(dbBuffer);

  try {
    const rulesSet: string[] = [];
    const rulesValues: Array<number | string> = [];

    if (changes.name !== undefined) {
      rulesSet.push("Name = ?");
      rulesValues.push(changes.name);
    }
    if (changes.enabled !== undefined) {
      rulesSet.push("State = ?");
      rulesValues.push(changes.enabled ? "1" : "0");
    }

    if (rulesSet.length > 0) {
      db.query(`UPDATE RULES SET ${rulesSet.join(", ")} WHERE RuleID = ?`).run(
        ...rulesValues,
        ruleId
      );
    }

    const ruleDevicesSet: string[] = [];
    const ruleDevicesValues: number[] = [];

    if (changes.startTime !== undefined) {
      ruleDevicesSet.push("StartTime = ?");
      ruleDevicesValues.push(changes.startTime);
    }
    if (changes.endTime !== undefined) {
      ruleDevicesSet.push("EndTime = ?");
      ruleDevicesValues.push(changes.endTime);
    }
    if (changes.startAction !== undefined) {
      ruleDevicesSet.push("StartAction = ?");
      ruleDevicesValues.push(Number(changes.startAction));
    }
    if (changes.endAction !== undefined) {
      ruleDevicesSet.push("EndAction = ?");
      ruleDevicesValues.push(Number(changes.endAction));
    }
    if (changes.dayId !== undefined) {
      ruleDevicesSet.push("DayID = ?");
      ruleDevicesValues.push(changes.dayId);
    }

    if (ruleDevicesSet.length > 0) {
      db.query(`UPDATE RULEDEVICES SET ${ruleDevicesSet.join(", ")} WHERE RuleID = ?`).run(
        ...ruleDevicesValues,
        ruleId
      );
    }

    return db.serialize();
  } finally {
    db.close();
  }
}

/**
 * Deletes a timer rule from a serialized WeMo rules database.
 *
 * @param dbBuffer - Serialized SQLite DB bytes
 * @param ruleId - RuleID to delete
 * @returns Updated serialized SQLite DB bytes
 */
export function deleteRuleFromDb(dbBuffer: Uint8Array, ruleId: number): Uint8Array {
  const db = openDatabaseFromBuffer(dbBuffer);

  try {
    db.query("DELETE FROM RULES WHERE RuleID = ?").run(ruleId);
    db.query("DELETE FROM RULEDEVICES WHERE RuleID = ?").run(ruleId);
    db.query("DELETE FROM TARGETDEVICES WHERE RuleID = ?").run(ruleId);
    return db.serialize();
  } finally {
    db.close();
  }
}

/**
 * Toggles a timer rule enabled state in a serialized WeMo rules database.
 *
 * @param dbBuffer - Serialized SQLite DB bytes
 * @param ruleId - RuleID to toggle
 * @param enabled - Desired enabled state
 * @returns Updated serialized SQLite DB bytes
 */
export function toggleRuleInDb(dbBuffer: Uint8Array, ruleId: number, enabled: boolean): Uint8Array {
  const db = openDatabaseFromBuffer(dbBuffer);

  try {
    db.query("UPDATE RULES SET State = ? WHERE RuleID = ?").run(enabled ? "1" : "0", ruleId);
    return db.serialize();
  } finally {
    db.close();
  }
}

/**
 * Fetches the rules ZIP via SOAP and returns serialized DB bytes with version.
 *
 * @param host - Device host
 * @param port - Device port
 * @returns Rules DB buffer and current version
 */
export async function fetchRulesDb(
  host: string,
  port: number
): Promise<{ dbBuffer: Uint8Array; version: number }> {
  interface FetchRulesResponse {
    ruleDbVersion?: unknown;
    ruleDbPath?: unknown;
  }

  const response = await soapRequest<FetchRulesResponse>(
    host,
    port,
    RULES_CONTROL_URL,
    RULES_SERVICE,
    "FetchRules"
  );

  if (!response.success) {
    console.warn("[Rules] FetchRules failed, using empty rules DB", {
      host,
      port,
      error: response.error ?? "Unknown error",
    });
    return { dbBuffer: createEmptyRulesDb(), version: 0 };
  }

  const version = Number.parseInt(extractTextValue(response.data?.ruleDbVersion), 10) || 0;
  const ruleDbPath = extractTextValue(response.data?.ruleDbPath);

  console.debug("[Rules] FetchRules response", {
    host,
    port,
    version,
    hasRuleDbPath: Boolean(ruleDbPath),
    ruleDbPath,
  });

  if (!ruleDbPath) {
    console.warn("[Rules] Missing ruleDbPath from FetchRules, using empty rules DB", {
      host,
      port,
      version,
    });
    return { dbBuffer: createEmptyRulesDb(), version };
  }

  try {
    const zipResponse = await fetch(toRuleDbUrl(host, port, ruleDbPath));
    if (!zipResponse.ok) {
      console.warn("[Rules] Failed to download rules ZIP, using empty rules DB", {
        host,
        port,
        version,
        status: zipResponse.status,
        statusText: zipResponse.statusText,
      });
      return { dbBuffer: createEmptyRulesDb(), version: 0 };
    }

    const zipBuffer = new Uint8Array(await zipResponse.arrayBuffer());
    const files = unzipSync(zipBuffer);
    const dbBuffer = files[RULES_DB_FILENAME] ?? Object.values(files)[0];

    if (!dbBuffer) {
      console.warn("[Rules] Rules ZIP missing SQLite payload, using empty rules DB", {
        host,
        port,
        version,
        zipEntries: Object.keys(files),
      });
      return { dbBuffer: createEmptyRulesDb(), version: 0 };
    }

    console.debug("[Rules] Loaded rules DB", {
      host,
      port,
      version,
      zipEntries: Object.keys(files),
      dbBytes: dbBuffer.length,
    });

    return { dbBuffer, version };
  } catch {
    console.warn("[Rules] Failed to parse downloaded rules DB, using empty rules DB", {
      host,
      port,
      version,
    });
    return { dbBuffer: createEmptyRulesDb(), version: 0 };
  }
}

/**
 * Stores a serialized rules DB via SOAP StoreRules.
 *
 * @param host - Device host
 * @param port - Device port
 * @param dbBuffer - Serialized SQLite DB bytes
 * @param version - Current rules DB version
 */
export async function storeRulesDb(
  host: string,
  port: number,
  dbBuffer: Uint8Array,
  version: number
): Promise<void> {
  const zipped = zipSync({ [RULES_DB_FILENAME]: dbBuffer });
  const base64 = Buffer.from(zipped).toString("base64");
  const nextVersion = version + 1;
  const body = `<ruleDbVersion>${nextVersion}</ruleDbVersion><processDb>1</processDb><ruleDbBody>&lt;![CDATA[${base64}]]&gt;</ruleDbBody>`;

  console.debug("[Rules] Storing rules DB", {
    host,
    port,
    currentVersion: version,
    nextVersion,
    dbBytes: dbBuffer.length,
    zipBytes: zipped.length,
    base64Length: base64.length,
  });

  const response = await soapRequest(
    host,
    port,
    RULES_CONTROL_URL,
    RULES_SERVICE,
    "StoreRules",
    body
  );

  if (!response.success) {
    console.error("[Rules] StoreRules failed", {
      host,
      port,
      currentVersion: version,
      nextVersion,
      error: response.error ?? "Unknown error",
    });
    throw new Error(`Failed to store rules DB: ${response.error ?? "Unknown error"}`);
  }

  console.debug("[Rules] StoreRules succeeded", {
    host,
    port,
    nextVersion,
    statusCode: response.statusCode,
  });
}

/**
 * Fetches and parses all timer rules for a device.
 *
 * @param host - Device host
 * @param port - Device port
 * @param deviceId - Device identifier for schedule result
 * @returns Timer schedule payload with version
 */
export async function fetchTimers(
  host: string,
  port: number,
  deviceId: string
): Promise<TimerSchedule> {
  const { dbBuffer, version } = await fetchRulesDb(host, port);
  return {
    deviceId,
    rules: parseRulesFromDb(dbBuffer),
    dbVersion: version,
  };
}

/**
 * Adds a timer rule to a device and returns the created rule.
 *
 * @param host - Device host
 * @param port - Device port
 * @param rule - New timer rule input
 * @param deviceUdn - Device UDN
 * @returns Created timer rule
 */
export async function addTimer(
  host: string,
  port: number,
  rule: CreateTimerInput,
  deviceUdn: string
): Promise<TimerRule> {
  const { dbBuffer, version } = await fetchRulesDb(host, port);
  const updatedDb = addRuleToDb(dbBuffer, rule, deviceUdn);
  await syncDeviceTime(host, port);
  await storeRulesDb(host, port, updatedDb, version);

  const rules = parseRulesFromDb(updatedDb);

  const newRule = [...rules].sort((a, b) => a.ruleID - b.ruleID).at(-1);
  if (!newRule) {
    throw new Error("Failed to parse created timer rule");
  }
  return newRule;
}

/**
 * Updates a timer rule on a device and returns the updated rule.
 *
 * @param host - Device host
 * @param port - Device port
 * @param ruleId - RuleID to update
 * @param changes - Partial timer update fields
 * @param deviceUdn - Device UDN (unused, kept for API consistency)
 * @returns Updated timer rule
 */
export async function updateTimer(
  host: string,
  port: number,
  ruleId: number,
  changes: UpdateTimerInput,
  deviceUdn: string
): Promise<TimerRule> {
  void deviceUdn;

  const { dbBuffer, version } = await fetchRulesDb(host, port);
  const updatedDb = updateRuleInDb(dbBuffer, ruleId, changes);
  await syncDeviceTime(host, port);
  await storeRulesDb(host, port, updatedDb, version);

  const allRules = parseRulesFromDb(updatedDb);

  const updatedRule = allRules.find((rule) => rule.ruleID === ruleId);
  if (!updatedRule) {
    throw new Error(`Timer rule ${ruleId} not found after update`);
  }
  return updatedRule;
}

/**
 * Deletes a timer rule from a device.
 *
 * @param host - Device host
 * @param port - Device port
 * @param ruleId - RuleID to delete
 * @param deviceUdn - Device UDN (unused, kept for API consistency)
 */
export async function deleteTimer(
  host: string,
  port: number,
  ruleId: number,
  deviceUdn: string
): Promise<void> {
  void deviceUdn;

  const { dbBuffer, version } = await fetchRulesDb(host, port);
  const updatedDb = deleteRuleFromDb(dbBuffer, ruleId);
  await syncDeviceTime(host, port);
  await storeRulesDb(host, port, updatedDb, version);
}

/**
 * Toggles a timer rule enabled state on a device and returns the updated rule.
 *
 * @param host - Device host
 * @param port - Device port
 * @param ruleId - RuleID to toggle
 * @param enabled - Desired enabled state
 * @param deviceUdn - Device UDN (unused, kept for API consistency)
 * @returns Updated timer rule
 */
export async function toggleTimer(
  host: string,
  port: number,
  ruleId: number,
  enabled: boolean,
  deviceUdn: string
): Promise<TimerRule> {
  void deviceUdn;

  const { dbBuffer, version } = await fetchRulesDb(host, port);
  const updatedDb = toggleRuleInDb(dbBuffer, ruleId, enabled);
  await syncDeviceTime(host, port);
  await storeRulesDb(host, port, updatedDb, version);

  const allRules = parseRulesFromDb(updatedDb);

  const updatedRule = allRules.find((rule) => rule.ruleID === ruleId);
  if (!updatedRule) {
    throw new Error(`Timer rule ${ruleId} not found after toggle`);
  }
  return updatedRule;
}

/**
 * Converts seconds from midnight to a 12-hour time string.
 *
 * @param seconds - Seconds from midnight
 * @returns Time string in "HH:MM AM/PM" format
 */
export function secondsToTimeString(seconds: number): string {
  const normalized = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  const hours24 = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/**
 * Converts a 12-hour time string to seconds from midnight.
 *
 * @param timeStr - Time string in "HH:MM AM/PM" format
 * @returns Seconds from midnight
 */
export function timeStringToSeconds(timeStr: string): number {
  const match = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/.exec(timeStr);
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  const [, hoursText, minutesText, meridiemText] = match;
  if (!hoursText || !minutesText || !meridiemText) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);
  const meridiem = meridiemText.toUpperCase();

  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time value: ${timeStr}`);
  }

  const normalizedHours = hours % 12;
  const hours24 = meridiem === "PM" ? normalizedHours + 12 : normalizedHours;
  return hours24 * 3600 + minutes * 60;
}

/**
 * Converts a day bitmask to an ordered list of day names.
 *
 * @param dayId - WeMo day bitmask
 * @returns Day names in Sun-Sat order
 */
export function dayIdToDayNames(dayId: number): string[] {
  if (dayId === DAYS.DAILY || dayId === DAYS.ALL) {
    return [...DAY_NAMES];
  }
  if (dayId === DAYS.WEEKDAYS) {
    return ["Mon", "Tue", "Wed", "Thu", "Fri"];
  }
  if (dayId === DAYS.WEEKENDS) {
    return ["Sun", "Sat"];
  }

  return DAY_NAMES.filter((_, index) => {
    const bit = DAY_BITS[index] ?? 0;
    return (dayId & bit) !== 0;
  });
}

/**
 * Converts a day bitmask to a human-readable label.
 *
 * @param dayId - WeMo day bitmask
 * @returns Label such as Daily, Weekdays, Weekends, or joined day names
 */
export function dayIdToLabel(dayId: number): string {
  if (dayId === DAYS.DAILY || dayId === DAYS.ALL) {
    return "Daily";
  }
  if (dayId === DAYS.WEEKDAYS) {
    return "Weekdays";
  }
  if (dayId === DAYS.WEEKENDS) {
    return "Weekends";
  }

  const names = dayIdToDayNames(dayId);
  return names.join(", ");
}
