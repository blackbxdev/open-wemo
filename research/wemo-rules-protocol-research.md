# Wemo UPnP/SOAP Protocol: Rules, Timers & Schedules

## Research Date: 2026-02-21

---

## 1. Wemo UPnP Services Overview

A Wemo device advertises multiple UPnP services. The complete list (from pywemo's auto-generated service stubs):

| Service Name | Service Type | Purpose |
|---|---|---|
| **basicevent** | `urn:Belkin:service:basicevent:1` | Core device control (on/off, state, name) |
| **rules** | `urn:Belkin:service:rules:1` | **Rules/timers/schedules management** |
| **timesync** | `urn:Belkin:service:timesync:1` | Time synchronization |
| **firmwareupdate** | `urn:Belkin:service:firmwareupdate:1` | Firmware management |
| **deviceinfo** | `urn:Belkin:service:deviceinfo:1` | Device information |
| **deviceevent** | `urn:Belkin:service:deviceevent:1` | Device event/attribute management |
| **metainfo** | `urn:Belkin:service:metainfo:1` | Metadata |
| **remoteaccess** | `urn:Belkin:service:remoteaccess:1` | Cloud remote access |
| **WiFiSetup** | `urn:Belkin:service:WiFiSetup:1` | WiFi configuration |
| **manufacture** | `urn:Belkin:service:manufacture:1` | Manufacturing data |
| **smartsetup** | `urn:Belkin:service:smartsetup:1` | Smart setup/pairing |
| **insight** | `urn:Belkin:service:insight:1` | Power monitoring (Insight only) |
| **bridge** | `urn:Belkin:service:bridge:1` | Bulb/group management (Link only) |

### Control URLs (typical)
- basicevent: `/upnp/control/basicevent1`
- rules: `/upnp/control/rules1`
- timesync: `/upnp/control/timesync1`

---

## 2. The `rules:1` Service — Complete Action List

The `urn:Belkin:service:rules:1` service exposes these SOAP actions:

| Action | Purpose |
|---|---|
| **`FetchRules`** | Returns the rules database path and version (for SQLite download) |
| **`StoreRules`** | Uploads a modified rules database back to the device |
| **`GetRules`** | Gets rules as XML (simpler format, likely legacy) |
| **`SetRules`** | Sets rules via XML |
| **`GetRulesDBPath`** | Gets the path to the rules database file |
| **`GetRulesDBVersion`** | Gets the current version number of the rules DB |
| **`SetRulesDBVersion`** | Sets the rules DB version |
| **`SetRuleID`** | Sets/creates a specific rule by ID |
| **`DeleteRuleID`** | Deletes a specific rule by ID |
| **`GetTemplates`** | Gets rule templates |
| **`SetTemplates`** | Sets rule templates |
| **`SimulatedRuleData`** | Simulated/test rule data |
| **`UpdateWeeklyCalendar`** | Updates weekly calendar schedule |
| **`EditWeeklycalendar`** | Edits weekly calendar |
| **`DeleteWeeklyCalendar`** | Deletes weekly calendar |

### Key Insight: Two Approaches to Rules

Wemo devices support **two different mechanisms** for managing rules:

1. **SQLite Database Approach** (used by pywemo) — `FetchRules` → download SQLite DB → modify → `StoreRules`
2. **XML/SOAP Approach** (simpler) — `GetRules`/`SetRules`/`SetRuleID`/`DeleteRuleID`

---

## 3. SQLite Database Approach (pywemo's Method)

This is the most well-documented approach, used by pywemo for long-press rules.

### Flow:
```
1. Call FetchRules → returns { ruleDbVersion, ruleDbPath }
2. HTTP GET ruleDbPath → downloads a ZIP containing a SQLite database
3. Modify the SQLite database locally
4. ZIP + Base64 encode the modified database
5. Call StoreRules with the new version and encoded database
```

### FetchRules SOAP Request:
```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:FetchRules xmlns:u="urn:Belkin:service:rules:1">
    </u:FetchRules>
  </s:Body>
</s:Envelope>
```

**SOAPACTION header:** `"urn:Belkin:service:rules:1#FetchRules"`

### FetchRules Response:
```xml
<s:Envelope ...>
  <s:Body>
    <u:FetchRulesResponse xmlns:u="urn:Belkin:service:rules:1">
      <ruleDbVersion>42</ruleDbVersion>
      <ruleDbPath>http://192.168.1.100:49153/rules.db</ruleDbPath>
    </u:FetchRulesResponse>
  </s:Body>
</s:Envelope>
```

### StoreRules SOAP Request:
```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:StoreRules xmlns:u="urn:Belkin:service:rules:1">
      <ruleDbVersion>43</ruleDbVersion>
      <processDb>1</processDb>
      <ruleDbBody>&lt;![CDATA[BASE64_ENCODED_ZIP_OF_SQLITE_DB]]&gt;</ruleDbBody>
    </u:StoreRules>
  </s:Body>
</s:Envelope>
```

**Important:** The `ruleDbBody` contains a base64-encoded ZIP file containing the SQLite database. The CDATA wrapper is HTML-entity-encoded (`&lt;` instead of `<`).

### SQLite Database Schema

The rules database has these tables:

#### RULES Table
| Column | Type | Description |
|---|---|---|
| `RuleID` | INTEGER PRIMARY KEY | Unique rule identifier |
| `Name` | TEXT NOT NULL | Human-readable rule name |
| `Type` | TEXT NOT NULL | Rule type (see below) |
| `RuleOrder` | INTEGER | Execution priority |
| `StartDate` | TEXT | Start date (format: "MMDDYYYY") |
| `EndDate` | TEXT | End date |
| `State` | TEXT | "1" = enabled, "0" = disabled |
| `Sync` | INTEGER | Sync status ("NOSYNC" stored as text in INTEGER column) |

**Known Rule Types:**
- `"Long Press"` — Button long-press rules
- `"Timer"` — Timer/schedule rules  
- `"Simple"` — Simple on/off rules
- `"Sunrise"` / `"Sunset"` — Astronomical timer rules

#### RULEDEVICES Table
| Column | Type | Description |
|---|---|---|
| `RuleDevicePK` | INTEGER PRIMARY KEY AUTOINCREMENT | Row ID |
| `RuleID` | INTEGER | Foreign key to RULES |
| `DeviceID` | TEXT | Device UDN |
| `GroupID` | INTEGER | Group association |
| `DayID` | INTEGER | Day of week bitmask (-1 = all days) |
| `StartTime` | INTEGER | Start time in **seconds from midnight** |
| `RuleDuration` | INTEGER | Duration in seconds |
| `StartAction` | REAL | Action at start (1.0=ON, 0.0=OFF, 2.0=TOGGLE) |
| `EndAction` | REAL | Action at end (-1.0 = no action) |
| `SensorDuration` | INTEGER | Sensor duration (-1 = N/A) |
| `Type` | INTEGER | Device type (-1 = default) |
| `Value` | INTEGER | Value parameter (-1 = default) |
| `Level` | INTEGER | Level/brightness (-1 = default) |
| `ZBCapabilityStart` | TEXT | ZigBee capability at start |
| `ZBCapabilityEnd` | TEXT | ZigBee capability at end |
| `OnModeOffset` | INTEGER | On mode offset (-1 = N/A) |
| `OffModeOffset` | INTEGER | Off mode offset (-1 = N/A) |
| `CountdownTime` | INTEGER | Countdown time (-1 = N/A) |
| `EndTime` | INTEGER | End time in seconds from midnight |

#### TARGETDEVICES Table
| Column | Type | Description |
|---|---|---|
| `TargetDevicesPK` | INTEGER PRIMARY KEY AUTOINCREMENT | Row ID |
| `RuleID` | INTEGER | Foreign key to RULES |
| `DeviceID` | TEXT | Target device UDN |
| `DeviceIndex` | INTEGER | Order index |

#### DEVICECOMBINATION Table
| Column | Type | Description |
|---|---|---|
| `DeviceCombinationPK` | INTEGER PRIMARY KEY AUTOINCREMENT | Row ID |
| `RuleID` | INTEGER | Foreign key to RULES |
| `SensorID` | TEXT | Sensor device ID |
| `SensorGroupID` | INTEGER | Sensor group |
| `DeviceID` | TEXT | Target device ID |
| `DeviceGroupID` | INTEGER | Target group |

#### Other Tables
- `GROUPDEVICES` — Group membership
- `LOCATIONINFO` — Location data (for sunrise/sunset)
- `BLOCKEDRULES` — Blocked rule IDs
- `RULESNOTIFYMESSAGE` — Notification messages
- `SENSORNOTIFICATION` — Sensor notifications

### DayID Bitmask Values

The `DayID` field uses a bitmask for days of the week:
- `-1` = Every day
- `0` = Sunday
- `1` = Monday  
- `2` = Tuesday
- `3` = Wednesday
- `4` = Thursday
- `5` = Friday
- `6` = Saturday
- Combinations use comma-separated values or bitmask

### Time Values

Times are stored as **seconds from midnight**:
- `0` = 00:00:00 (midnight)
- `60` = 00:01:00
- `3600` = 01:00:00
- `43200` = 12:00:00
- `86340` = 23:59:00
- `86400` = 24:00:00

### Example: Creating a Timer Rule (Turn ON at 7:00 AM daily, OFF at 11:00 PM)

```sql
-- Insert the rule
INSERT INTO RULES (RuleID, Name, Type, RuleOrder, StartDate, EndDate, State, Sync)
VALUES (1, 'Daily Schedule', 'Timer', 0, '12201982', '07301982', '1', 'NOSYNC');

-- Insert the rule device (defines when and what action)
INSERT INTO RULEDEVICES (RuleID, DeviceID, GroupID, DayID, StartTime, RuleDuration, 
                         StartAction, EndAction, SensorDuration, Type, Value, Level,
                         ZBCapabilityStart, ZBCapabilityEnd, OnModeOffset, OffModeOffset,
                         CountdownTime, EndTime)
VALUES (1, 'uuid:Socket-1_0-XXXXXXXXXXXX', 0, -1, 25200, 57600, 
        1.0, 0.0, -1, -1, -1, -1, '', '', -1, -1, -1, 82800);
-- StartTime=25200 (7:00 AM), EndTime=82800 (11:00 PM)
-- StartAction=1.0 (ON), EndAction=0.0 (OFF)
-- DayID=-1 (every day)
```

---

## 4. XML/SOAP Approach (GetRules/SetRules/SetRuleID/DeleteRuleID)

These actions work with rules as XML, which may be simpler for basic timer operations.

### GetRules SOAP Request:
```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetRules xmlns:u="urn:Belkin:service:rules:1">
    </u:GetRules>
  </s:Body>
</s:Envelope>
```

### GetRules Response (expected format):
```xml
<s:Envelope ...>
  <s:Body>
    <u:GetRulesResponse xmlns:u="urn:Belkin:service:rules:1">
      <RuleList>
        <!-- URL-encoded or CDATA-wrapped XML -->
      </RuleList>
    </u:GetRulesResponse>
  </s:Body>
</s:Envelope>
```

### DeleteRuleID SOAP Request:
```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:DeleteRuleID xmlns:u="urn:Belkin:service:rules:1">
      <ruleID>1</ruleID>
    </u:DeleteRuleID>
  </s:Body>
</s:Envelope>
```

### Weekly Calendar Actions

```xml
<!-- UpdateWeeklyCalendar -->
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:UpdateWeeklyCalendar xmlns:u="urn:Belkin:service:rules:1">
      <CalendarData><!-- URL-encoded XML schedule data --></CalendarData>
    </u:UpdateWeeklyCalendar>
  </s:Body>
</s:Envelope>

<!-- DeleteWeeklyCalendar -->
<u:DeleteWeeklyCalendar xmlns:u="urn:Belkin:service:rules:1">
  <CalendarID>1</CalendarID>
</u:DeleteWeeklyCalendar>
```

---

## 5. Related basicevent Actions

The `basicevent:1` service also has some rule-related actions:

| Action | Purpose |
|---|---|
| `GetSimulatedRuleData` | Get data for simulated/away mode rules |
| `GetRuleOverrideStatus` | Check if rules are being overridden |
| `SetAwayRuleTask` | Set away-mode rule behavior |

---

## 6. Time Sync Service

The `urn:Belkin:service:timesync:1` service is important for timer accuracy:

| Action | Purpose |
|---|---|
| `TimeSync` | Synchronize device clock |
| `GetTime` | Get current device time |
| `GetDeviceTime` | Get device time (alternative) |

### TimeSync Request:
```xml
<u:TimeSync xmlns:u="urn:Belkin:service:timesync:1">
  <UTC>1234567890</UTC>
  <TimeZone>-0700</TimeZone>
  <dst>1</dst>
  <DstSupported>1</DstSupported>
</u:TimeSync>
```

---

## 7. Existing Open-Source Implementations

### pywemo (Python) — Most Complete
**Location:** `pywemo/ouimeaux_device/api/rules_db.py` + `long_press.py`

pywemo uses the **SQLite database approach**:
1. `FetchRules` → get DB URL and version
2. Download ZIP'd SQLite DB
3. Modify with Python sqlite3 module  
4. ZIP + base64 → `StoreRules`

Currently only implements **long press rules**, not timer/schedule rules. But the infrastructure is fully generic — the same DB tables and approach would work for timers.

Key code pattern:
```python
with rules_db_from_device(device) as rules_db:
    # rules_db.rules — all RULES rows
    # rules_db.rule_devices — all RULEDEVICES rows
    # rules_db.add_rule(RulesRow(...))
    # rules_db.remove_rule(rule)
    # rules_db.add_rule_devices(RuleDevicesRow(...))
    # On context exit, if modified, StoreRules is called automatically
```

### wemo-client (Node.js)
**Location:** `timonreinhard/wemo-client`

Does **NOT** implement rules/timers at all. Only implements:
- `basicevent:1` — GetBinaryState, SetBinaryState
- `bridge:1` — GetEndDevices, SetDeviceStatus, GetDeviceStatus
- `insight:1` — GetInsightParams
- `deviceevent:1` — GetAttributes, SetAttributes

### homebridge-wemo (Node.js)
**Location:** `homebridge-plugins/homebridge-wemo`

Does **NOT** implement rules/timers. Focuses on real-time control and UPnP event subscriptions for state changes. Based on wemo-client internals.

### ouimeaux (Python, legacy)
The original Python WeMo library. pywemo is a fork/evolution of it. ouimeaux didn't implement rules either — pywemo added that.

---

## 8. Implementation Recommendations for open-wemo

### Approach 1: SQLite DB Method (Recommended)
Use `FetchRules`/`StoreRules` like pywemo. This is the most proven approach.

**Steps to implement:**
1. Add `rules:1` service support to the SOAP client
2. Implement `FetchRules` call → parse ruleDbVersion and ruleDbPath
3. HTTP GET the ruleDbPath → get ZIP content
4. Unzip → get SQLite database
5. Use a SQLite library (e.g., `better-sqlite3` or `bun:sqlite`) to read/modify
6. For creating timers: INSERT into RULES + RULEDEVICES tables
7. For deleting: DELETE from both tables
8. For editing: UPDATE the relevant rows
9. ZIP + base64 encode → call `StoreRules` with incremented version

**TypeScript skeleton:**
```typescript
const RULES_SERVICE = "urn:Belkin:service:rules:1";
const RULES_CONTROL_URL = "/upnp/control/rules1";

// Fetch the rules database
async function fetchRulesDb(device: WemoDevice) {
  const response = await soapRequest(
    device.host, device.port, RULES_CONTROL_URL,
    RULES_SERVICE, "FetchRules"
  );
  // response.data = { ruleDbVersion, ruleDbPath }
  const { ruleDbVersion, ruleDbPath } = response.data;
  
  // Download the ZIP'd SQLite DB
  const dbResponse = await fetch(ruleDbPath);
  const zipBuffer = await dbResponse.arrayBuffer();
  
  // Unzip and open with SQLite
  // ... unzip logic ...
  // ... sqlite3 open ...
  
  return { db, version: parseInt(ruleDbVersion) };
}

// Store modified rules database
async function storeRulesDb(device: WemoDevice, db: Buffer, version: number) {
  // ZIP the database
  // ... zip logic ...
  const base64Zip = zipBuffer.toString('base64');
  
  await soapRequest(
    device.host, device.port, RULES_CONTROL_URL,
    RULES_SERVICE, "StoreRules",
    `<ruleDbVersion>${version + 1}</ruleDbVersion>
     <processDb>1</processDb>
     <ruleDbBody>&lt;![CDATA[${base64Zip}]]&gt;</ruleDbBody>`
  );
}
```

### Approach 2: Direct SOAP Actions (Simpler but Less Tested)
Use `SetRuleID`/`DeleteRuleID` for individual rule management without the full SQLite dance. Less battle-tested in the wild, but potentially simpler.

### Recommended API Design for open-wemo:
```typescript
interface TimerRule {
  id: number;
  name: string;
  enabled: boolean;
  days: number[];  // 0=Sun, 1=Mon, ..., 6=Sat, or [-1] for daily
  startTime: { hour: number; minute: number };
  endTime?: { hour: number; minute: number };
  startAction: 'on' | 'off' | 'toggle';
  endAction?: 'on' | 'off' | 'none';
}

// Device client methods
async getTimerRules(): Promise<TimerRule[]>
async createTimerRule(rule: Omit<TimerRule, 'id'>): Promise<TimerRule>
async updateTimerRule(rule: TimerRule): Promise<void>
async deleteTimerRule(ruleId: number): Promise<void>
```

---

## 9. Key Caveats

1. **Version conflicts**: Always increment `ruleDbVersion` when storing. If another client modified rules in between, you may overwrite their changes.

2. **Empty DB handling**: If a device has never had rules, the `ruleDbPath` URL may return 404. In that case, create an empty SQLite DB with the proper schema.

3. **Date format**: StartDate/EndDate in RULES table use "MMDDYYYY" format. The values "12201982" and "07301982" appear to be placeholder/sentinel values (pywemo uses these).

4. **CDATA encoding**: The `ruleDbBody` in StoreRules uses HTML-entity-encoded CDATA: `&lt;![CDATA[...]]&gt;` not `<![CDATA[...]]>`.

5. **Device reboot**: After storing rules, the device may take a moment to process. The `processDb=1` parameter tells it to apply immediately.

6. **ZIP format**: The database is stored as a ZIP file containing a single file named `temppluginRules.db` (for new DBs) or whatever filename was in the original ZIP.

7. **Service availability**: Not all Wemo devices support the `rules:1` service. Check the device's setup.xml service list first.
