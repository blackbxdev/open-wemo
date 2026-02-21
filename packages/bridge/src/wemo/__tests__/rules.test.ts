import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { unzipSync, zipSync } from "fflate";
import {
  addRuleToDb,
  createEmptyRulesDb,
  dayIdToDayNames,
  dayIdToLabel,
  deleteRuleFromDb,
  parseRulesFromDb,
  secondsToTimeString,
  timeStringToSeconds,
  toggleRuleInDb,
  updateRuleInDb,
} from "../rules";
import { type CreateTimerInput, DAYS, TimerAction } from "../types";

function readRuleCount(db: Database): number {
  const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM RULES").get();
  return Number(row?.count ?? 0);
}

function readRuleDevicesCount(db: Database): number {
  const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM RULEDEVICES").get();
  return Number(row?.count ?? 0);
}

function readTargetDevicesCount(db: Database): number {
  const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM TARGETDEVICES").get();
  return Number(row?.count ?? 0);
}

function createRuleInput(overrides: Partial<CreateTimerInput> = {}): CreateTimerInput {
  return {
    name: "Morning",
    dayId: DAYS.DAILY,
    startTime: 25200,
    endTime: 82800,
    startAction: TimerAction.On,
    endAction: TimerAction.Off,
    ...overrides,
  };
}

describe("secondsToTimeString", () => {
  test("midnight", () => {
    expect(secondsToTimeString(0)).toBe("12:00 AM");
  });

  test("7am", () => {
    expect(secondsToTimeString(25200)).toBe("7:00 AM");
  });

  test("noon", () => {
    expect(secondsToTimeString(43200)).toBe("12:00 PM");
  });

  test("11pm", () => {
    expect(secondsToTimeString(82800)).toBe("11:00 PM");
  });

  test("end of day wraps to midnight", () => {
    expect(secondsToTimeString(86400)).toBe("12:00 AM");
  });

  test("with minutes", () => {
    expect(secondsToTimeString(25200 + 1800)).toBe("7:30 AM");
  });
});

describe("timeStringToSeconds", () => {
  test("midnight", () => {
    expect(timeStringToSeconds("12:00 AM")).toBe(0);
  });

  test("7am", () => {
    expect(timeStringToSeconds("7:00 AM")).toBe(25200);
  });

  test("noon", () => {
    expect(timeStringToSeconds("12:00 PM")).toBe(43200);
  });

  test("11pm", () => {
    expect(timeStringToSeconds("11:00 PM")).toBe(82800);
  });

  test("7:30am", () => {
    expect(timeStringToSeconds("7:30 AM")).toBe(27000);
  });

  test("roundtrip", () => {
    expect(timeStringToSeconds(secondsToTimeString(25200))).toBe(25200);
  });
});

describe("dayIdToLabel", () => {
  test("-1 -> Daily", () => {
    expect(dayIdToLabel(-1)).toBe("Daily");
  });

  test("62 -> Weekdays", () => {
    expect(dayIdToLabel(62)).toBe("Weekdays");
  });

  test("65 -> Weekends", () => {
    expect(dayIdToLabel(65)).toBe("Weekends");
  });

  test("127 -> Daily", () => {
    expect(dayIdToLabel(127)).toBe("Daily");
  });

  test("single day 2 -> Mon", () => {
    expect(dayIdToLabel(2)).toBe("Mon");
  });

  test("combo 6 -> Mon, Tue", () => {
    expect(dayIdToLabel(6)).toBe("Mon, Tue");
  });

  test("single day 1 -> Sun", () => {
    expect(dayIdToLabel(1)).toBe("Sun");
  });
});

describe("dayIdToDayNames", () => {
  test("-1 -> all days", () => {
    expect(dayIdToDayNames(-1)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  test("62 -> weekdays", () => {
    expect(dayIdToDayNames(62)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  test("65 -> weekends", () => {
    expect(dayIdToDayNames(65)).toEqual(["Sun", "Sat"]);
  });

  test("127 -> all days", () => {
    expect(dayIdToDayNames(127)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });
});

describe("createEmptyRulesDb", () => {
  test("returns valid buffer", () => {
    const buf = createEmptyRulesDb();
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("can be opened as SQLite DB", () => {
    const db = Database.deserialize(createEmptyRulesDb());
    expect(db).toBeTruthy();
    db.close();
  });

  test("has required tables", () => {
    const db = Database.deserialize(createEmptyRulesDb());
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all();
    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toContain("RULES");
    expect(tableNames).toContain("RULEDEVICES");
    expect(tableNames).toContain("TARGETDEVICES");
    db.close();
  });
});

describe("parseRulesFromDb", () => {
  test("empty DB returns empty array", () => {
    expect(parseRulesFromDb(createEmptyRulesDb())).toEqual([]);
  });

  test("parses Timer rule correctly", () => {
    const db = Database.deserialize(createEmptyRulesDb());
    db.exec(
      "INSERT INTO RULES VALUES (1, 'Test Timer', 'Timer', 0, '12201982', '07301982', '1', 'NOSYNC')"
    );
    db.exec(
      "INSERT INTO RULEDEVICES (RuleID, DeviceID, GroupID, DayID, StartTime, RuleDuration, StartAction, EndAction, SensorDuration, Type, Value, Level, ZBCapabilityStart, ZBCapabilityEnd, OnModeOffset, OffModeOffset, CountdownTime, EndTime) VALUES (1, 'uuid:test', 0, -1, 25200, -1, 1.0, 0.0, -1, -1, -1, -1, '', '', -1, -1, -1, 82800)"
    );

    const buffer = db.serialize();
    db.close();

    const rules = parseRulesFromDb(buffer);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.ruleID).toBe(1);
    expect(rules[0]?.name).toBe("Test Timer");
    expect(rules[0]?.type).toBe("Timer");
    expect(rules[0]?.enabled).toBe(true);
    expect(rules[0]?.startTime).toBe(25200);
    expect(rules[0]?.endTime).toBe(82800);
    expect(rules[0]?.startAction).toBe(1);
    expect(rules[0]?.endAction).toBe(0);
    expect(rules[0]?.dayId).toBe(-1);
  });

  test("filters non-Timer rules", () => {
    const db = Database.deserialize(createEmptyRulesDb());
    db.exec(
      "INSERT INTO RULES VALUES (1, 'Long Press Rule', 'Long Press', 0, '12201982', '07301982', '1', 'NOSYNC')"
    );
    db.exec(
      "INSERT INTO RULEDEVICES (RuleID, DeviceID, GroupID, DayID, StartTime, RuleDuration, StartAction, EndAction, SensorDuration, Type, Value, Level, ZBCapabilityStart, ZBCapabilityEnd, OnModeOffset, OffModeOffset, CountdownTime, EndTime) VALUES (1, 'uuid:test', 0, -1, 25200, -1, 1.0, 0.0, -1, -1, -1, -1, '', '', -1, -1, -1, 82800)"
    );

    const buffer = db.serialize();
    db.close();

    expect(parseRulesFromDb(buffer)).toEqual([]);
  });
});

describe("addRuleToDb", () => {
  test("adds rule with correct RuleID", () => {
    const base = createEmptyRulesDb();
    const first = addRuleToDb(base, createRuleInput({ name: "First" }), "uuid:device");
    const second = addRuleToDb(first, createRuleInput({ name: "Second" }), "uuid:device");
    const parsed = parseRulesFromDb(second);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.ruleID).toBe(1);
    expect(parsed[1]?.ruleID).toBe(2);
  });

  test("first rule gets ID 1", () => {
    const updated = addRuleToDb(createEmptyRulesDb(), createRuleInput(), "uuid:device");
    const parsed = parseRulesFromDb(updated);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.ruleID).toBe(1);
  });

  test("assigns correct RULEDEVICES values", () => {
    const updated = addRuleToDb(
      createEmptyRulesDb(),
      createRuleInput({
        dayId: DAYS.WEEKDAYS,
        startTime: 28800,
        endTime: 75600,
        startAction: TimerAction.Toggle,
        endAction: TimerAction.Off,
      }),
      "uuid:device-1"
    );

    const db = Database.deserialize(updated);
    const row = db
      .query<
        {
          deviceId: string;
          dayId: number;
          startTime: number;
          endTime: number;
          startAction: number;
          endAction: number;
        },
        []
      >(
        "SELECT DeviceID AS deviceId, DayID AS dayId, StartTime AS startTime, EndTime AS endTime, StartAction AS startAction, EndAction AS endAction FROM RULEDEVICES WHERE RuleID = 1"
      )
      .get();

    expect(row?.deviceId).toBe("uuid:device-1");
    expect(Number(row?.dayId)).toBe(DAYS.WEEKDAYS);
    expect(Number(row?.startTime)).toBe(28800);
    expect(Number(row?.endTime)).toBe(75600);
    expect(Number(row?.startAction)).toBe(TimerAction.Toggle);
    expect(Number(row?.endAction)).toBe(TimerAction.Off);
    db.close();
  });

  test("inserts into TARGETDEVICES", () => {
    const updated = addRuleToDb(createEmptyRulesDb(), createRuleInput(), "uuid:target");
    const db = Database.deserialize(updated);
    const row = db
      .query<{ deviceId: string; deviceIndex: number }, []>(
        "SELECT DeviceID AS deviceId, DeviceIndex AS deviceIndex FROM TARGETDEVICES WHERE RuleID = 1"
      )
      .get();

    expect(row?.deviceId).toBe("uuid:target");
    expect(Number(row?.deviceIndex)).toBe(0);
    db.close();
  });
});

describe("updateRuleInDb", () => {
  test("updates name", () => {
    const base = addRuleToDb(
      createEmptyRulesDb(),
      createRuleInput({ name: "Before" }),
      "uuid:device"
    );
    const updated = updateRuleInDb(base, 1, { name: "After" });
    const parsed = parseRulesFromDb(updated);

    expect(parsed[0]?.name).toBe("After");
  });

  test("updates time/action/dayId", () => {
    const base = addRuleToDb(createEmptyRulesDb(), createRuleInput(), "uuid:device");
    const updated = updateRuleInDb(base, 1, {
      startTime: 30600,
      endTime: 79200,
      startAction: TimerAction.Toggle,
      endAction: TimerAction.On,
      dayId: DAYS.WEEKENDS,
    });
    const parsed = parseRulesFromDb(updated);

    expect(parsed[0]?.startTime).toBe(30600);
    expect(parsed[0]?.endTime).toBe(79200);
    expect(parsed[0]?.startAction).toBe(TimerAction.Toggle);
    expect(parsed[0]?.endAction).toBe(TimerAction.On);
    expect(parsed[0]?.dayId).toBe(DAYS.WEEKENDS);
  });

  test("preserves unchanged fields", () => {
    const base = addRuleToDb(
      createEmptyRulesDb(),
      createRuleInput({ name: "Keep", startTime: 25200, endTime: 82800, dayId: DAYS.WEEKDAYS }),
      "uuid:device"
    );
    const updated = updateRuleInDb(base, 1, { enabled: false });
    const parsed = parseRulesFromDb(updated);

    expect(parsed[0]?.name).toBe("Keep");
    expect(parsed[0]?.startTime).toBe(25200);
    expect(parsed[0]?.endTime).toBe(82800);
    expect(parsed[0]?.dayId).toBe(DAYS.WEEKDAYS);
    expect(parsed[0]?.enabled).toBe(false);
  });
});

describe("deleteRuleFromDb", () => {
  test("removes from all three tables", () => {
    const withRule = addRuleToDb(createEmptyRulesDb(), createRuleInput(), "uuid:device");
    const deleted = deleteRuleFromDb(withRule, 1);
    const db = Database.deserialize(deleted);

    expect(readRuleCount(db)).toBe(0);
    expect(readRuleDevicesCount(db)).toBe(0);
    expect(readTargetDevicesCount(db)).toBe(0);
    db.close();
  });

  test("leaves other rules intact", () => {
    const first = addRuleToDb(
      createEmptyRulesDb(),
      createRuleInput({ name: "One" }),
      "uuid:device"
    );
    const second = addRuleToDb(first, createRuleInput({ name: "Two" }), "uuid:device");
    const deleted = deleteRuleFromDb(second, 1);
    const parsed = parseRulesFromDb(deleted);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.ruleID).toBe(2);
    expect(parsed[0]?.name).toBe("Two");
  });
});

describe("toggleRuleInDb", () => {
  test("disables rule", () => {
    const withRule = addRuleToDb(createEmptyRulesDb(), createRuleInput(), "uuid:device");
    const toggled = toggleRuleInDb(withRule, 1, false);
    const parsed = parseRulesFromDb(toggled);

    expect(parsed[0]?.enabled).toBe(false);
  });

  test("enables rule", () => {
    const withRule = addRuleToDb(createEmptyRulesDb(), createRuleInput(), "uuid:device");
    const disabled = toggleRuleInDb(withRule, 1, false);
    const enabled = toggleRuleInDb(disabled, 1, true);
    const parsed = parseRulesFromDb(enabled);

    expect(parsed[0]?.enabled).toBe(true);
  });
});

describe("zip round-trip", () => {
  test("round-trip DB through ZIP", () => {
    const dbBuffer = createEmptyRulesDb();
    const zipped = zipSync({ "temppluginRules.db": dbBuffer });
    const unzipped = unzipSync(zipped);
    const extractedDb = unzipped["temppluginRules.db"];

    expect(extractedDb).toBeTruthy();
    if (!extractedDb) {
      throw new Error("Expected temppluginRules.db in ZIP payload");
    }

    const db = Database.deserialize(extractedDb);
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    expect(tables.length).toBeGreaterThanOrEqual(3);
    db.close();
  });

  test("ZIP contains exactly temppluginRules.db", () => {
    const dbBuffer = createEmptyRulesDb();
    const zipped = zipSync({ "temppluginRules.db": dbBuffer });
    const files = unzipSync(zipped);
    const keys = Object.keys(files);

    expect(keys).toEqual(["temppluginRules.db"]);
  });
});
